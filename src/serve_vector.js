'use strict';

var async = require('async'),
    crypto = require('crypto'),
    path = require('path'),
    zlib = require('zlib');

var clone = require('clone'),
    express = require('express'),
    mbtiles = require('mbtiles');

var utils = require('./utils');

function CompositeSource(repo, ids, id) {
  this.repo = repo;
  this.ids = ids;
  this.id = id;
}

CompositeSource.prototype.getTile = function(z, x, y, callback) {
  var queue = [];
  this.ids.forEach(function(id) {
    queue.push(function(callback) {
      this.repo[id].source.getTile(z, x, y, function(err, data, headers) {
        if (err) {
          return callback(null, null);
        } else {
          zlib.gunzip(data, function(err, gunzipped) {
            if (err) {
              callback(null, null);
            } else {
              callback(null, gunzipped);
            }
          });
        }
      });
    }.bind(this));
  }.bind(this));

  return async.parallel(queue, function(err, results) {
    var buffers = [];
    results.forEach(function(result) {
      if (result) buffers.push(result);
    });
    var concated = Buffer.concat(buffers);
    if (concated.length == 0) {
      //return callback(null, new Buffer(0), {});
      return callback(new Error('does not exist'), null, {});
    } else {
      return zlib.gzip(concated, function(err, gzipped) {
        return callback(err, gzipped, {
          'Content-type': 'application/x-protobuf',
          'content-encoding': 'gzip'
        });
      });
    }
  });
};


CompositeSource.prototype.getTileJSON = function() {
  var result = null;
  this.ids.forEach(function(id) {
    var single = clone(this.repo[id].tileJSON);
    if (!result) {
      result = single;
    } else {
      result['name'] = (result['name'] || '') + ', ' + (single['name'] || '');
      result['attribution'] = (result['attribution'] || '') + ', ' +
                              (single['attribution'] || '');
      result['description'] = (result['description'] || '') + ', ' +
                              (single['description'] || '');
      result['minzoom'] = Math.min(result['minzoom'] || 0,
                                   single['minzoom'] || 0);
      result['maxzoom'] = Math.max(result['maxzoom'], single['maxzoom']);
      if (single['bounds']) {
        if (result['bounds']) {
          result['bounds'] = [
            Math.min(result['bounds'][0], single['bounds'][0]),
            Math.min(result['bounds'][1], single['bounds'][1]),
            Math.max(result['bounds'][2], single['bounds'][2]),
            Math.max(result['bounds'][3], single['bounds'][3])
          ];
        } else {
          result['bounds'] = single['bounds'];
        }
      }
      result['vector_layers'] =
          (result['vector_layers'] || []).concat(single['vector_layers']);
    }
  }.bind(this));

  delete result['filesize'];
  result['tilejson'] = '2.0.0';
  result['basename'] = this.id;
  result['format'] = 'pbf';

  utils.fixTileJSONCenter(result);
  return result;
};


module.exports = function(options, repo, params, id, callback) {
  var app = express().disable('x-powered-by');

  var mbtilesFile = params.mbtiles;
  var tileJSON = {
    'tiles': params.domains || options.domains
  };

  repo[id] = {
    tileJSON: tileJSON
  };

  var source;
  if (!params.ids) {
    source = new mbtiles(path.join(options.paths.mbtiles, mbtilesFile),
                         function(err) {
      source.getInfo(function(err, info) {
        tileJSON['name'] = id;

        Object.assign(tileJSON, info);

        tileJSON['tilejson'] = '2.0.0';
        tileJSON['basename'] = id;
        tileJSON['format'] = 'pbf';

        Object.assign(tileJSON, params.tilejson || {});
        utils.fixTileJSONCenter(tileJSON);
        if (callback) callback();
      });
    });
  } else {
    source = new CompositeSource(repo, params.ids, id);
    repo[id].tileJSON = tileJSON = source.getTileJSON();
    if (callback) setTimeout(callback, 0);
  }
  repo[id].source = source;

  var tilePattern = '/vector/' + id + '/:z(\\d+)/:x(\\d+)/:y(\\d+).pbf';

  app.get(tilePattern, function(req, res, next) {
    var z = req.params.z | 0,
        x = req.params.x | 0,
        y = req.params.y | 0;
    if (z < tileJSON.minzoom || 0 || x < 0 || y < 0 ||
        z > tileJSON.maxzoom ||
        x >= Math.pow(2, z) || y >= Math.pow(2, z)) {
      return res.status(404).send('Out of bounds');
    }
    source.getTile(z, x, y, function(err, data, headers) {
      if (err) {
        if (/does not exist/.test(err.message)) {
          return res.status(404).send(err.message);
        } else {
          return res.status(500).send(err.message);
        }
      } else {
        var md5 = crypto.createHash('md5').update(data).digest('base64');
        headers['content-md5'] = md5;
        headers['content-type'] = 'application/x-protobuf';
        headers['content-encoding'] = 'gzip';
        res.set(headers);

        if (data == null) {
          return res.status(404).send('Not found');
        } else {
          return res.status(200).send(data);
        }
      }
    });
  });

  app.get('/vector/' + id + '.json', function(req, res, next) {
    var info = clone(tileJSON);
    info.tiles = utils.getTileUrls(req, info.tiles,
                                   'vector/' + id, info.format);
    return res.send(info);
  });

  return app;
};
