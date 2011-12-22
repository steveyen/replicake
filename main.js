#!/usr/bin/env node

var nconf = require('nconf')
  .argv()
  .env()
  .add('local',   { type: 'file', file: 'etc/local.json' })
  .add('default', { type: 'file', file: 'etc/default.json' });

require(nconf.get('replicake') || './replicake')
  .start_replica(nconf);
