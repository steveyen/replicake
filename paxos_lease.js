var assert = require('assert');
var paxos  = require('./paxos');

// Algorithm adapted from: "PaxosLease: Diskless Paxos for Leases",
// by Trencseni, Gazso, Reinhardt.
//
exports.lease_acquirer = function(lease_timeout, // In milliseconds.
                                  node_name, node_restarts,
                                  acceptors, comm, opts) {
  var timer = null;
  var owner = false; // Tri-state: true, false, 'timeout'.

  opts = opts || {};
  opts.msg_preprocess = function(src, msg) {
    if (msg.kind == paxos.RES_PROPOSED) {
      if (msg.accepted_ballot != null ||
          msg.accepted_val != null) {
        msg.kind = paxos.RES_NACK;
      }
    }
    return msg;
  };
  opts.on_phase_complete = function(kind, err) {
    if (kind == paxos.RES_PROPOSED && !err) {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(function() { owner = 'timeout'; },
                         lease_timeout);
    }
  };

  var proposer = paxos.proposer(node_name, node_restarts,
                                acceptors, 0, comm, opts);

  val propose = proposer.propose; // Keep a private copy of propose().
  proposer.propose = null;        // All propose()'s go through acquire().

  proposer.acquire = function(cb) {
    var val = { "lease_owner"   : node_name,
                "lease_timeout" : lease_timeout };
    return propose(val,
                   function(err, info) {
                     if (!err && !is_owner()) {
                       owner = true;
                     }
                     cb(proposer.is_owner());
                   });
  };

  proposer.is_owner = function() { return owner == true; };

  return proposer;
};

exports.lease_acceptor = function(comm, opts) {
  var highest_proposed_ballot = null;
  var accepted_ballot         = null;
  var accepted_val            = null;
  var timer                   = null;

  opts = opts || {};
  opts.respond_preprocess = function(msg) {
    msg.accepted_ballot = accepted_ballot;
    msg.accepted_val    = accepted_val;
    return msg;
  }

  var lease_storage = {
    "slot_read": function(slot, cb) {
      assert(slot == 0);
      cb(false, { "highest_proposed_ballot": highest_proposed_ballot,
                  "accepted_ballot":         accepted_ballot,
                  "accepted_val":            accepted_val });
    },
    "slot_save_highest_proposed_ballot": function(slot, ballot, cb) {
      assert(slot == 0);
      highest_proposed_ballot = ballot;
      cb(false);
    },
    "slot_save_accepted": function(slot, ballot, val, cb) {
      assert(slot == 0);
      accepted_ballot = ballot;
      accepted_val    = null;

      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(function() {
                           accepted_ballot = null;
                           accepted_val    = null;
                         }, val.lease_timeout);
      cb(false);
    }
  };

  return paxos.acceptor(lease_storage, comm, opts);
};
