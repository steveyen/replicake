#!/usr/bin/env node

var nconf = require('nconf')
  .argv()
  .env()
  .add('local',   { type: 'file', file: 'etc/local.json' })
  .add('default', { type: 'file', file: 'etc/default.json' });

var rep = require('./replicake').start_replica(nconf);

var app = require('express').createServer();

app.get('/', function(req, res) {
  res.send('hello world, from replicake');
});

var port = nconf.get('port');
app.listen(port);
console.log("listening: " + port);
