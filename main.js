#!/usr/bin/env node

var nconf = require('nconf')
  .argv()
  .env()
  .add('local',   { type: 'file', file: 'etc/local.json' })
  .add('default', { type: 'file', file: 'etc/default.json' });

var log_db_conf   = nconf.get('log_db') || {};
var log_db_module = require('./log_db_' + (log_db_conf.kind || 'json'));

var rep = require('./replicake').open_replica(nconf, log_db_module)
                                .warm();

var app = require('express').createServer();

app.get('/', function(req, res) {
  res.send('hello world, from replicake');
});

var port = nconf.get('port');
app.listen(port);
console.log("listening: " + port);

