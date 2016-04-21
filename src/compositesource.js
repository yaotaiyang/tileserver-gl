'use strict';

var async = require('async'),
    crypto = require('crypto'),
    path = require('path'),
    zlib = require('zlib');

var clone = require('clone'),
    express = require('express'),
    mbtiles = require('mbtiles');

var utils = require('./utils');


function CompositeSource(getSourceByIds, ids, id, callback) {
  this.getSourceByIds = getSourceByIds;
  this.ids = ids;
  this.id = id;

  var queue = [];
  this.ids.forEach(function(id) {
    queue.push(function(cb) {
      this.getSourceByIds([id], function(err, id, source) {
        cb(null);
      });
    }.bind(this));
  }.bind(this));

  async.parallel(queue, function(err, results) {
    callback(null);
  }.bind(this));
}

CompositeSource.prototype.getTile = function(z, x, y, callback) {
  var queue = [];
  this.ids.forEach(function(id) {
    queue.push(function(callback) {
      this.getSourceByIds([id], function(err, id, source) {
        source.getTile(z, x, y, function(err, data, headers) {
          //console.log(z, x, y, err, source);
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
      });
    }.bind(this));
  }.bind(this));

  return async.parallel(queue, function(err, results) {
    var buffers = [];
    results.forEach(function(result) {
      if (result) buffers.push(result);
    });
    var concated = Buffer.concat(buffers);
    console.log(concated.length);
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


CompositeSource.prototype.getInfo = function(callback) {
  var result = null;

  var queue = [];
  this.ids.forEach(function(id) {
    queue.push(function(cb) {
      this.getSourceByIds([id], function(err, id, source) {
        console.log('got', id);
        source.getInfo(function(err, info) {
          var single = clone(info);
          console.log(info['name']);

          if (!result) {
            result = single;
          } else {
            console.log(result['name']);
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
          cb(null);
        });
      });
    }.bind(this));
  }.bind(this));
  console.log(queue.length);

  return async.parallel(queue, function(err, results) {
    if (result['filesize']) {
      delete result['filesize'];
    }
    result['tilejson'] = '2.0.0';
    result['basename'] = this.id;
    result['format'] = 'pbf';

    utils.fixTileJSONCenter(result);
    callback(null, result);
  }.bind(this));
};

module.exports = CompositeSource;
