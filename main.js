#!/usr/bin/env node

var assert = require('assert');

var nconf = require('nconf')
  .argv()
  .env()
  .add('local',   { type: 'file', file: 'etc/local.json' })
  .add('default', { type: 'file', file: 'etc/default.json' });

var storage_conf = nconf.get('storage') || {};
var storage      = require('./storage_' + (storage_conf.kind || 'json'));

var data_dir   = nconf.get('data-dir');
var node_name  = nconf.get('node-name');

assert(node_name != null &&
       node_name.toString().length > 0,
       "ERROR: missing node_name for replicake node.");

var exp = require('express').createServer();
var rep = require('./replicake').mk_node(node_name, data_dir, nconf, storage, exp);

exp.get('/', function(req, res) {
  res.send('hello world, from replicake');
});

var port = nconf.get('port');
console.log("listening: " + port);
exp.listen(port);

rep.open();


