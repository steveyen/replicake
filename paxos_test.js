#!/usr/bin/env node

var assert = require('assert');
var paxos  = require('./paxos');

function ballot_test() {
  console.log("ballot_test...");
  with (paxos) {
    var a = ballot_mk(1, 0, 0);
    var assert = require('assert');
    assert(ballot_gte(a, ballot_mk(-1, -1, -1)));
    assert(ballot_gte(ballot_mk(1, 1, 1), a));
    assert(ballot_gte(ballot_mk(1, 1, 0), a));
    assert(ballot_gte(ballot_mk(1, 0, 1), a));
    assert(ballot_gte(ballot_mk(1, 0, 0), a));
    assert(!ballot_gte(ballot_mk(0, 0, 0), a));
    assert(!ballot_gte(ballot_mk(0, 0, 1), a));
    assert(!ballot_gte(ballot_mk(0, 1, 0), a));
    assert(!ballot_gte(ballot_mk(0, 1, 1), a));
  }
  console.log("ballot_test... ok.");
}
ballot_test();

console.log("DONE.");
