#!/usr/bin/env node

var assert = require('assert');
var paxos  = require('./paxos');

function ballot_test() {
  console.log("ballot_test...");
  with (paxos) {
    var a = ballot_mk(1, 0, 0);
    assert(ballot_gte(a, ballot_mk(-1, -1, -1)));
    assert(ballot_gte(ballot_mk(1, 1, 1), a));
    assert(ballot_gte(ballot_mk(1, 1, 0), a));
    assert(ballot_gte(ballot_mk(1, 0, 1), a));
    assert(ballot_gte(ballot_mk(1, 0, 0), a));
    assert(!ballot_gte(ballot_mk(0, 0, 0), a));
    assert(!ballot_gte(ballot_mk(0, 0, 1), a));
    assert(!ballot_gte(ballot_mk(0, 1, 0), a));
    assert(!ballot_gte(ballot_mk(0, 1, 1), a));
    assert(ballot_gte(ballot_inc(a), a));
    assert(ballot_gte(a, a));
    assert(ballot_eq(a, a));
    assert(!ballot_eq(ballot_inc(a), a));
  }
  console.log("ballot_test... ok");
}
ballot_test();

function majority_test() {
  console.log("majority_test...");
  with (paxos) {
    assert(majority(4) == 3);
    assert(majority(3) == 2);
    assert(majority(2) == 2);
    assert(majority(1) == 1);
    assert(majority(0) == 1);
  }
  console.log("majority_test... ok");
}
majority_test();

function is_member_test() {
  console.log("is_member_test...");
  with (paxos) {
    assert(is_member([10], 10));
    assert(is_member([10,20], 10));
    assert(is_member([10,20], 20));
    assert(!is_member([10,20], 30));
    assert(!is_member([10], 30));
    assert(!is_member([], 30));
  }
  console.log("is_member_test... ok");
}
is_member_test();

function create_test() {
  console.log("create_test...");
  with (paxos) {
    assert(proposer('A', 1, 0, ['A'], null, null));
    try {
      proposer('A', 1, 0, [], null, null);
      assert(false);
    } catch (ex) { assert(ex); }
  }
  console.log("create_test... ok");
}
create_test();

function propose_phase_test() {
  console.log("propose_phase_test...");
  var broadcasts = [];
  var comm = {
    "broadcast": function(acceptors, msg) {
      broadcasts[broadcasts.length] = [acceptors, msg];
    }
  }
  var proposer = paxos.proposer('A', 1, 0, ['A'], comm, null);
  proposer.propose(123,
                   function(err, info) {
                   });
  console.log("propose_phase_test... ok");
}
propose_phase_test();

console.log("DONE.");
