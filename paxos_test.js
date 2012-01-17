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
    assert(acceptor({}, {}));
  }
  console.log("ok create_test");
}
create_test();

// ------------------------------------------------

function log(msg) { console.log("   " + msg); }

var to_s = JSON.stringify;
var blackboard = {};

function mock_comm(name, bb) {
  bb = bb || blackboard || {};
  bb.broadcasts = [];
  bb.sends = [];
  var comm = {
    "broadcast": function(acceptors, msg) {
      bb.broadcasts[bb.broadcasts.length] = [acceptors, msg];
      for (var i in acceptors) {
        comm.send(acceptors[i], msg);
      }
    },
    "send": function(dst, msg) {
      log("comm.heard: " + dst + ", " + JSON.stringify(msg));
      bb.sends[bb.sends.length] = [dst, msg, name];
    }
  };
  return comm;
}

function mock_storage() {
  var slots = {};

  function get(slot) {
    slots[slot] = slots[slot] || {};
    return slots[slot];
  }

  var storage = {
    "history": [],
    "slot_read": function(slot, cb) {
      var slot = get(slot);
      if (slot) {
        cb(false, {
            "highest_proposed_ballot": slot.highest_proposed_ballot,
            "accepted_ballot":         slot.accepted_ballot,
            "accepted_val":            slot.accepted_val });
      } else {
        cb("missing");
      }
    },
    "slot_save_highest_proposed_ballot": function(slot, hpb, cb) {
      storage.history[storage.history.length] =
        ["slot_save_highest_proposed_ballot", slot, hpb];
      var slot = get(slot);
      if (slot) {
        slot.highest_proposed_ballot = hpb;
        cb(false);
      } else {
        cb(true);
      }
    },
    "slot_save_accepted": function(slot, ballot, val, cb) {
      storage.history[storage.history.length] =
        ["slot_save_accepted", slot, ballot, val];
      var slot = get(slot);
      if (slot) {
        slot.accepted_ballot = ballot;
        slot.accepted_val = val;
        cb(false);
      } else {
        cb(true);
      }
    }
  };
  return storage;
}

var testi = -1; // Current test.

function test_start(test_name) {
  console.log(".. " + test_name);
}

function test_ok(test_name) {
  console.log("ok " + test_name);
  testi++;
  if (testi < tests.length) {
    tests[testi]();
  } else {
    console.log("DONE");
  }
}

// ------------------------------------------------

function propose_phase_test() {
  test_start("propose_phase_test");

  var proposer = blackboard.proposer =
    paxos.proposer('A', 1, 0, ['B'], mock_comm('A'),
                   { proposer_timeout: 100 });
  proposer.propose(123, propose_phase_test_cb);
}

function propose_phase_test_cb(err, info) {
  assert(err == 'timeout');
  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.broadcasts[0][0].length == 1);
  assert(blackboard.broadcasts[0][0][0] == 'B');
  assert(blackboard.broadcasts[0][1].kind == paxos.REQ_PROPOSE);
  assert(paxos.ballot_eq(blackboard.broadcasts[0][1].ballot,
                         paxos.ballot_mk(0, 'A', 1)));
  assert(blackboard.proposer.stats().tot_propose_phase == 1);

  test_ok("propose_phase_test");
}

function propose_two_test() {
  test_start("propose_two_test");

  // Two propose() calls.
  blackboard.callback_count = 0;
  var proposer = blackboard.proposer =
    paxos.proposer('A', 1, 0, ['B'], mock_comm('A'),
                   { proposer_timeout: 100 });
  proposer.propose(123, propose_two_test_cb);
  proposer.propose(234, propose_two_test_cb);
}

function propose_two_test_cb(err, info) {
  // Should be called twice.
  assert(err == 'timeout');
  blackboard.callback_count++;
  assert(blackboard.callback_count <= 2);
  if (blackboard.callback_count < 2) {
    return;
  }

  assert(blackboard.broadcasts.length == 2);
  assert(blackboard.broadcasts[0][0].length == 1);
  assert(blackboard.broadcasts[0][0][0] == 'B');
  assert(blackboard.broadcasts[0][1].kind == paxos.REQ_PROPOSE);
  assert(paxos.ballot_eq(blackboard.broadcasts[0][1].ballot,
                         paxos.ballot_mk(0, 'A', 1)));
  assert(blackboard.broadcasts[1][0].length == 1);
  assert(blackboard.broadcasts[1][0][0] == 'B');
  assert(blackboard.broadcasts[1][1].kind == paxos.REQ_PROPOSE);
  assert(paxos.ballot_eq(blackboard.broadcasts[1][1].ballot,
                         paxos.ballot_mk(1, 'A', 1)));
  assert(blackboard.proposer.stats().tot_propose_phase == 2);

  test_ok("propose_two_test");
}

function propose_2_acceptors_test() {
  test_start("propose_2_acceptors_test");

  blackboard.callback_count = 0;
  var proposer = blackboard.proposer =
    paxos.proposer('A', 1, 0, ['B', 'C'], mock_comm('A'),
                   { proposer_timeout: 100 });
  proposer.propose(123, propose_2_acceptors_test_cb);
}

function propose_2_acceptors_test_cb(err, info) {
  assert(err == 'timeout');
  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.broadcasts[0][0].length == 2);
  assert(blackboard.broadcasts[0][0][0] == 'B');
  assert(blackboard.broadcasts[0][0][1] == 'C');
  assert(blackboard.broadcasts[0][1].kind == paxos.REQ_PROPOSE);
  assert(paxos.ballot_eq(blackboard.broadcasts[0][1].ballot,
                         paxos.ballot_mk(0, 'A', 1)));
  assert(blackboard.proposer.stats().tot_propose_phase == 1);
  assert(blackboard.proposer.stats().tot_propose_send == 2);

  test_ok("propose_2_acceptors_test");
}

function paxos_1_1_half_test() {
  test_start("paxos_1_1_half_test");

  blackboard = {};
  var storage = blackboard.storage = mock_storage();
  var acceptor = blackboard.acceptor =
    paxos.acceptor(storage, mock_comm('B'));
  var proposer = blackboard.proposer =
    paxos.proposer('A', 1, 0, ['B'], mock_comm('A'),
                   { proposer_timeout: 100 });

  proposer.propose(123, paxos_1_1_half_test_cb);

  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.sends.length == 1);
  assert(blackboard.sends[0][0] == 'B');
  assert(blackboard.sends[0][1].kind == paxos.REQ_PROPOSE);

  acceptor.on_msg('A', blackboard.sends[0][1]);

  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.sends.length == 2);
  assert(blackboard.sends[0][0] == 'B');
  assert(blackboard.sends[0][1].kind == paxos.REQ_PROPOSE);
  assert(blackboard.sends[1][0] == 'A');
  assert(blackboard.sends[1][1].kind == paxos.RES_PROPOSED);
  assert(paxos.ballot_eq(blackboard.sends[1][1].highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  assert(acceptor.stats().tot_accept_recv == 1);
  assert(acceptor.stats().tot_accept_send == 1);
  assert(acceptor.stats().tot_accept_propose == 1);
  assert(acceptor.stats().tot_accept_proposed == 1);
  assert(acceptor.stats().tot_accept_accept == 0);
  assert(acceptor.stats().tot_accept_accepted == 0);

  // Never send proposed response, so we'll timeout.
}

function paxos_1_1_half_test_cb(err, info) {
  assert(err == "timeout");

  test_ok("paxos_1_1_half_test");
}

function paxos_1_1_test() {
  test_start("paxos_1_1_test");

  blackboard = {};
  var storage = blackboard.storage = mock_storage();
  var acceptor = blackboard.acceptor =
    paxos.acceptor(storage, mock_comm('B'));
  var proposer = blackboard.proposer =
    paxos.proposer('A', 1, 0, ['B'], mock_comm('A'),
                   { proposer_timeout: 100 });

  var p = proposer.propose(123, paxos_1_1_test_cb);

  assert(p && p.on_msg);

  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.sends.length == 1);
  assert(blackboard.sends[0][0] == 'B');
  assert(blackboard.sends[0][1].kind == paxos.REQ_PROPOSE);

  acceptor.on_msg('A', blackboard.sends[0][1]);

  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.sends.length == 2);
  assert(blackboard.sends[0][0] == 'B');
  assert(blackboard.sends[0][1].kind == paxos.REQ_PROPOSE);
  assert(blackboard.sends[1][0] == 'A');
  assert(blackboard.sends[1][1].kind == paxos.RES_PROPOSED);
  assert(paxos.ballot_eq(blackboard.sends[1][1].highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  assert(acceptor.stats().tot_accept_recv == 1);
  assert(acceptor.stats().tot_accept_send == 1);
  assert(acceptor.stats().tot_accept_propose == 1);
  assert(acceptor.stats().tot_accept_proposed == 1);
  assert(acceptor.stats().tot_accept_accept == 0);
  assert(acceptor.stats().tot_accept_accepted == 0);

  p.on_msg('B', blackboard.sends[1][1]);

  assert(blackboard.broadcasts.length == 2);
  assert(blackboard.sends.length == 3);
  assert(blackboard.sends[0][0] == 'B');
  assert(blackboard.sends[0][1].slot == 0);
  assert(blackboard.sends[0][1].kind == paxos.REQ_PROPOSE);
  assert(blackboard.sends[1][0] == 'A');
  assert(blackboard.sends[1][1].kind == paxos.RES_PROPOSED);
  assert(paxos.ballot_eq(blackboard.sends[1][1].highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));
  assert(blackboard.sends[2][0] == 'B');
  assert(blackboard.sends[2][1].slot == 0);
  assert(blackboard.sends[2][1].kind == paxos.REQ_ACCEPT);
  assert(blackboard.sends[2][1].val == 123);
  assert(paxos.ballot_eq(blackboard.sends[2][1].ballot,
                         blackboard.sends[0][1].ballot));

  acceptor.on_msg('A', blackboard.sends[2][1]);

  assert(blackboard.broadcasts.length == 2);
  assert(blackboard.sends.length == 4);
  assert(blackboard.sends[0][0] == 'B');
  assert(blackboard.sends[0][1].slot == 0);
  assert(blackboard.sends[0][1].kind == paxos.REQ_PROPOSE);
  assert(blackboard.sends[1][0] == 'A');
  assert(blackboard.sends[1][1].kind == paxos.RES_PROPOSED);
  assert(paxos.ballot_eq(blackboard.sends[1][1].highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));
  assert(blackboard.sends[2][0] == 'B');
  assert(blackboard.sends[2][1].slot == 0);
  assert(blackboard.sends[2][1].kind == paxos.REQ_ACCEPT);
  assert(blackboard.sends[2][1].val == 123);
  assert(paxos.ballot_eq(blackboard.sends[2][1].ballot,
                         blackboard.sends[0][1].ballot));
  assert(blackboard.sends[3][0] == 'A');
  assert(blackboard.sends[3][1].kind == paxos.RES_ACCEPTED);
  assert(paxos.ballot_eq(blackboard.sends[1][1].highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  p.on_msg('B', blackboard.sends[3][1]);
}

function paxos_1_1_test_cb(err, info) {
  assert(!err);
  assert(paxos.ballot_eq(info.highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  var proposer = blackboard.proposer;
  assert(proposer.stats().tot_propose_phase == 2);
  assert(proposer.stats().tot_propose_phase_loop == 0);
  assert(proposer.stats().tot_propose_send == 2);
  assert(proposer.stats().tot_propose_recv == 2);
  assert(proposer.stats().tot_propose_recv_err == 0);
  assert(proposer.stats().tot_propose_vote == 2);
  assert(proposer.stats().tot_propose_vote_repeat == 0);
  assert(proposer.stats().tot_propose_timeout == 0);

  var acceptor = blackboard.acceptor;
  assert(acceptor.stats().tot_accept_bad_req == 0);
  assert(acceptor.stats().tot_accept_bad_req_kind == 0);
  assert(acceptor.stats().tot_accept_recv == 2);
  assert(acceptor.stats().tot_accept_send == 2);
  assert(acceptor.stats().tot_accept_propose == 1);
  assert(acceptor.stats().tot_accept_proposed == 1);
  assert(acceptor.stats().tot_accept_accept == 1);
  assert(acceptor.stats().tot_accept_accepted == 1);
  assert(acceptor.stats().tot_accept_nack_storage == 0);
  assert(acceptor.stats().tot_accept_nack_behind == 0);

  var storage = blackboard.storage;
  assert(storage.history[0][0] == "slot_save_highest_proposed_ballot");
  assert(storage.history[0][1] == 0);
  assert(paxos.ballot_eq(storage.history[0][2],
                         info.highest_proposed_ballot));
  assert(storage.history[1][0] == "slot_save_accepted");
  assert(storage.history[1][1] == 0);
  assert(paxos.ballot_eq(storage.history[1][2],
                         info.highest_proposed_ballot));
  assert(storage.history[1][3] == 123);

  test_ok("paxos_1_1_test");
}

// ------------------------------------------------

function test_gen_paxos(num_proposers, num_acceptors) {
  blackboard = { "proposers": [],
                 "acceptors": [],
                 "storages": [] };

  var acceptor_names = [];

  for (var i = 0; i < num_acceptors; i++) {
    var storage = blackboard.storages[blackboard.storages.length] =
      mock_storage();
    // Acceptors are named 'A', 'B', etc.
    var acceptor = blackboard.acceptors[blackboard.acceptors.length] =
      paxos.acceptor(storage, mock_comm(acceptor_name(i)));
    acceptor_names[acceptor_names.length] = acceptor_name(i);
  }

  for (var i = 0; i < num_proposers; i++) {
    // Proposers are named 'a', 'b', etc.
    var proposer = blackboard.proposers[blackboard.proposers.length] =
      paxos.proposer(proposer_name(i), 1,
                     0, acceptor_names, mock_comm(proposer_name(i)),
                     { proposer_timeout: 100 })
  }
}

function proposer_name(idx) { return String.fromCharCode(97 + idx); } // a.
function acceptor_name(idx) { return String.fromCharCode(65 + idx); } // A.

function name_idx(name) {
  var idx = name.charCodeAt(0);
  if (idx >= 97) {
    idx = idx - 97;
  } else if (idx >= 65) {
    idx = idx - 65;
  }
  return idx;
}

function drive_comm(cb) {
  var proposals = blackboard.proposals = [];
  for (var i = 0; i < blackboard.proposers.length; i++) {
    var val = 100 + i;
    log("proposing: " + val + " to: " + proposer_name(i));
    proposals[i] =
      blackboard.proposers[i].propose(100 + i, cb);
  }

  var i = 0;
  while (i < blackboard.sends.length) {
    var dst = blackboard.sends[i][0];
    var dst_idx = name_idx(dst);
    var msg = blackboard.sends[i][1];
    var src = blackboard.sends[i][2];
    log("comm.txmit: " + i + ", " + dst + ", " + to_s(msg) + ", " + dst_idx);

    if (msg.kind == paxos.REQ_PROPOSE ||
        msg.kind == paxos.REQ_ACCEPT) {
      blackboard.acceptors[dst_idx].on_msg(src, msg);
    } else {
      proposals[dst_idx].on_msg(src, msg);
    }

    i++;
  }
}

// ------------------------------------------------

function paxos_1_1_gen_test() {
  test_start("paxos_1_1_gen_test");

  test_gen_paxos(1, 1);

  var p = blackboard.proposers[0].propose(123, paxos_1_1_gen_test_cb);

  var acceptor = blackboard.acceptors[0];

  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.sends.length == 1);
  assert(blackboard.sends[0][0] == 'A');
  assert(blackboard.sends[0][1].kind == paxos.REQ_PROPOSE);

  acceptor.on_msg('a', blackboard.sends[0][1]);

  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.sends.length == 2);
  assert(blackboard.sends[1][0] == 'a');
  assert(blackboard.sends[1][1].kind == paxos.RES_PROPOSED);
  assert(paxos.ballot_eq(blackboard.sends[1][1].highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  p.on_msg('A', blackboard.sends[1][1]);

  assert(blackboard.broadcasts.length == 2);
  assert(blackboard.sends.length == 3);
  assert(blackboard.sends[2][0] == 'A');
  assert(blackboard.sends[2][1].slot == 0);
  assert(blackboard.sends[2][1].kind == paxos.REQ_ACCEPT);
  assert(blackboard.sends[2][1].val == 123);
  assert(paxos.ballot_eq(blackboard.sends[2][1].ballot,
                         blackboard.sends[0][1].ballot));

  acceptor.on_msg('a', blackboard.sends[2][1]);

  assert(blackboard.broadcasts.length == 2);
  assert(blackboard.sends.length == 4);
  assert(blackboard.sends[3][0] == 'a');
  assert(blackboard.sends[3][1].kind == paxos.RES_ACCEPTED);
  assert(paxos.ballot_eq(blackboard.sends[1][1].highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  p.on_msg('A', blackboard.sends[3][1]);
}

function paxos_1_1_gen_test_cb(err, info) {
  assert(!err);
  assert(paxos.ballot_eq(info.highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  var proposer = blackboard.proposers[0];
  assert(proposer.stats().tot_propose_phase == 2);
  assert(proposer.stats().tot_propose_phase_loop == 0);
  assert(proposer.stats().tot_propose_send == 2);
  assert(proposer.stats().tot_propose_recv == 2);
  assert(proposer.stats().tot_propose_recv_err == 0);
  assert(proposer.stats().tot_propose_vote == 2);
  assert(proposer.stats().tot_propose_vote_repeat == 0);
  assert(proposer.stats().tot_propose_timeout == 0);

  var acceptor = blackboard.acceptors[0];
  assert(acceptor.stats().tot_accept_bad_req == 0);
  assert(acceptor.stats().tot_accept_bad_req_kind == 0);
  assert(acceptor.stats().tot_accept_recv == 2);
  assert(acceptor.stats().tot_accept_send == 2);
  assert(acceptor.stats().tot_accept_propose == 1);
  assert(acceptor.stats().tot_accept_proposed == 1);
  assert(acceptor.stats().tot_accept_accept == 1);
  assert(acceptor.stats().tot_accept_accepted == 1);
  assert(acceptor.stats().tot_accept_nack_storage == 0);
  assert(acceptor.stats().tot_accept_nack_behind == 0);

  var storage = blackboard.storages[0];
  assert(storage.history[0][0] == "slot_save_highest_proposed_ballot");
  assert(storage.history[0][1] == 0);
  assert(paxos.ballot_eq(storage.history[0][2],
                         info.highest_proposed_ballot));
  assert(storage.history[1][0] == "slot_save_accepted");
  assert(storage.history[1][1] == 0);
  assert(paxos.ballot_eq(storage.history[1][2],
                         info.highest_proposed_ballot));
  assert(storage.history[1][3] == 123);

  test_ok("paxos_1_1_gen_test");
}

function paxos_1_1_gensend_test() {
  test_start("paxos_1_1_gensend_test");
  test_gen_paxos(1, 1);
  drive_comm(paxos_1_1_gensend_test_cb);
}

function paxos_1_1_gensend_test_cb(err, info) {
  assert(!err);
  assert(paxos.ballot_eq(info.highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  var proposer = blackboard.proposers[0];
  assert(proposer.stats().tot_propose_phase == 2);
  assert(proposer.stats().tot_propose_phase_loop == 0);
  assert(proposer.stats().tot_propose_send == 2);
  assert(proposer.stats().tot_propose_recv == 2);
  assert(proposer.stats().tot_propose_recv_err == 0);
  assert(proposer.stats().tot_propose_vote == 2);
  assert(proposer.stats().tot_propose_vote_repeat == 0);
  assert(proposer.stats().tot_propose_timeout == 0);

  var acceptor = blackboard.acceptors[0];
  assert(acceptor.stats().tot_accept_bad_req == 0);
  assert(acceptor.stats().tot_accept_bad_req_kind == 0);
  assert(acceptor.stats().tot_accept_recv == 2);
  assert(acceptor.stats().tot_accept_send == 2);
  assert(acceptor.stats().tot_accept_propose == 1);
  assert(acceptor.stats().tot_accept_proposed == 1);
  assert(acceptor.stats().tot_accept_accept == 1);
  assert(acceptor.stats().tot_accept_accepted == 1);
  assert(acceptor.stats().tot_accept_nack_storage == 0);
  assert(acceptor.stats().tot_accept_nack_behind == 0);

  var storage = blackboard.storages[0];
  assert(storage.history[0][0] == "slot_save_highest_proposed_ballot");
  assert(storage.history[0][1] == 0);
  assert(paxos.ballot_eq(storage.history[0][2],
                         info.highest_proposed_ballot));
  assert(storage.history[1][0] == "slot_save_accepted");
  assert(storage.history[1][1] == 0);
  assert(paxos.ballot_eq(storage.history[1][2],
                         info.highest_proposed_ballot));
  assert(storage.history[1][3] == 100);

  test_ok("paxos_1_1_gensend_test");
}

function paxos_1_2_gensend_test() {
  test_start("paxos_1_2_gensend_test");
  test_gen_paxos(1, 2);
  drive_comm(paxos_1_2_gensend_test_cb);
}

function paxos_1_2_gensend_test_cb(err, info) {
  assert(!err);
  assert(paxos.ballot_eq(info.highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  var proposer = blackboard.proposers[0];
  assert(proposer.stats().tot_propose_phase == 2);
  assert(proposer.stats().tot_propose_phase_loop == 2);
  assert(proposer.stats().tot_propose_send == 4);
  assert(proposer.stats().tot_propose_recv == 4);
  assert(proposer.stats().tot_propose_recv_err == 0);
  assert(proposer.stats().tot_propose_vote == 4);
  assert(proposer.stats().tot_propose_vote_repeat == 0);
  assert(proposer.stats().tot_propose_timeout == 0);

  for (var i in blackboard.acceptors) {
    var acceptor = blackboard.acceptors[i];
    assert(acceptor.stats().tot_accept_bad_req == 0);
    assert(acceptor.stats().tot_accept_bad_req_kind == 0);
    assert(acceptor.stats().tot_accept_recv == 2);
    assert(acceptor.stats().tot_accept_send == 2);
    assert(acceptor.stats().tot_accept_propose == 1);
    assert(acceptor.stats().tot_accept_proposed == 1);
    assert(acceptor.stats().tot_accept_accept == 1);
    assert(acceptor.stats().tot_accept_accepted == 1);
    assert(acceptor.stats().tot_accept_nack_storage == 0);
    assert(acceptor.stats().tot_accept_nack_behind == 0);
  }

  for (var i in blackboard.storages) {
    var storage = blackboard.storages[i];
    assert(storage.history[0][0] == "slot_save_highest_proposed_ballot");
    assert(storage.history[0][1] == 0);
    assert(paxos.ballot_eq(storage.history[0][2],
                           info.highest_proposed_ballot));
    assert(storage.history[1][0] == "slot_save_accepted");
    assert(storage.history[1][1] == 0);
    assert(paxos.ballot_eq(storage.history[1][2],
                           info.highest_proposed_ballot));
    assert(storage.history[1][3] == 100);
  }

  test_ok("paxos_1_2_gensend_test");
}

// ------------------------------------------------

var tests = [ propose_phase_test,
              propose_two_test,
              propose_2_acceptors_test,
              paxos_1_1_half_test,
              paxos_1_1_test,
              paxos_1_1_gen_test,
              paxos_1_1_gensend_test,
              paxos_1_2_gensend_test,
             ];

test_ok("...");

