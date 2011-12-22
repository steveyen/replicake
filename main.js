#!/usr/bin/env node

var nconf = require('nconf');

nconf.argv()
     .env()
     .add('local',   { type: 'file', file: 'etc/local.json' })
     .add('default', { type: 'file', file: 'etc/default.json' });

console.dir(nconf.get('x'));

