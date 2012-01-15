#!/usr/bin/env node

var assert = require('assert');
var paxos  = require('./paxos');

function ballot_test() {
  console.log(".. ballot_test");
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
  console.log("ok ballot_test");
}
ballot_test();

function majority_test() {
  console.log(".. majority_test");
  with (paxos) {
    assert(majority(4) == 3);
    assert(majority(3) == 2);
    assert(majority(2) == 2);
    assert(majority(1) == 1);
    assert(majority(0) == 1);
  }
  console.log("ok majority_test");
}
majority_test();

function is_member_test() {
  console.log(".. is_member_test");
  with (paxos) {
    assert(is_member([10], 10));
    assert(is_member([10,20], 10));
    assert(is_member([10,20], 20));
    assert(!is_member([10,20], 30));
    assert(!is_member([10], 30));
    assert(!is_member([], 30));
  }
  console.log("ok is_member_test");
}
is_member_test();

function create_test() {
  console.log(".. create_test");
  with (paxos) {
    assert(proposer('A', 1, 0, ['A'], null, null));
    try {
      proposer('A', 1, 0, [], null, null);
      assert(false);
    } catch (ex) { assert(ex); }
  }
  console.log("ok create_test");
}
create_test();

// ------------------------------------------------

var broadcasts = [];
propose_phase_test();

function propose_phase_test() {
  console.log(".. propose_phase_test");
  var comm = {
    "broadcast": function(acceptors, msg) {
      console.log("     received: " + acceptors + ", " + JSON.stringify(msg));
      broadcasts[broadcasts.length] = [acceptors, msg];
    }
  }
  var proposer = paxos.proposer('A', 1, 0, ['A'], comm, { proposer_timeout: 100 });
  proposer.propose(123, propose_phase_test_part1);
}

function propose_phase_test_part1(err, info) {
  assert(err == 'timeout');
  assert(broadcasts.length == 1);
  assert(broadcasts[0][0] == 'A');
  assert(broadcasts[0][1].kind == paxos.REQ_PROPOSE);
  assert(broadcasts[0][1].ballot);

  console.log("ok propose_phase_test");

  done();
}

function done() {
  console.log("DONE.");
}

