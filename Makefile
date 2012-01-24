test: paxos-test paxos-lease-test

paxos-test:
	./paxos_test.js

paxos-lease-test:
	./paxos_lease_test.js

run:
	./main.js --node-name=`hostname`
