#!/usr/bin/env node

'use strict';

var async = require('async');
var request = require('request');

var running = require('./server')({
  config: 'config.json',
  port: 8080
}, function() {

  var randomX = [34324, 34334, 34306, 34315, 34335, 34322, 34314, 34308];
  var randomY = [22953, 22956, 22942, 22959, 22941, 22947, 22950, 22957];

  var q = [];
  for (var i = 0; i < 5; i++) {
    for (var z = 14; z <= 16; z++) {
      randomX.forEach(function(x) {
        randomY.forEach(function(y) {
          var z_ = z.toString();
          var x_ = Math.floor(x / Math.pow(2, 16 - z));
          var y_ = Math.floor(y / Math.pow(2, 16 - z));
          q.push(function(callback) {
            request({
              url: 'http://localhost:8080/raster/test/' + z_ + '/' + x_ + '/' + y_ + '.png',
              encoding: null,
              gzip: true
            }, function(err, res, body) {
              callback(null);
            });
          });
        });
      });
    }
  }

  async.parallelLimit(q, 4, function(err, results) {
    console.log(global.timings);
    running.server.close();
    process.exit();
  });
});
