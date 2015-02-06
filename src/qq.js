var buffer = [];
for (var i = 0; i < 1000; i++) {
	buffer[i] = 0;
}

var VOLUME = 0;
var BRANCH = 1;

var END_OF_PATH = -1;

function getTag(node) {
	return node[0];
}

// VOLUMES

function makeVolume(numDims) {
	return buffer.slice(0, 1 + (2 * numDims));
}

function getValue(volume, dim) {
	return volume[1 + dim];
}

function getNumBits(volume, numDims, dim) {
	return volume[1 + numDims + dim];
}

function setNumBits(volume, numDims, dim, numBits) {
	volume[1 + numDims + dim] = numBits;
}

// PATHS

function getPath(value, bitsBefore, bitsAfter) {
	var numBits = Math.min(bitsAfter, 4);
	var chunk = (value >> (32 - bitsBefore - numBits)) & ((1 << numBits) - 1); // grab `numBits` bits from position `bitsBefore`
	return chunk + (1 << numBits) - 1; // stagger path so that there is space for all combinations of 0-4 bits
}

function PathIter(numDims, volume, dim, value, bitsBefore, bitsAfter) {
	this.numDims = numDims;
	this.volume = volume;
	this.dim = dim;
	this.value = value;
	this.bitsBefore = bitsBefore;
	this.bitsAfter = bitsAfter;
}

PathIter.prototype.nextPath = function() {
	if (this.bitsAfter >= 4) {
		this.bitsBefore += 4;
		this.bitsAfter -= 4;
	} else {
		this.dim += 1;
		if (this.dim < this.numDims) {
			this.value = getValue(this.volume, this.dim);
			this.bitsBefore = 0;
			this.bitsAfter = getNumBits(this.volume, this.numDims, this.dim);
		} else {
			return END_OF_PATH;
		}
	}
	return getPath(this.value, this.bitsBefore, this.bitsAfter);
};

PathIter.prototype.copy = function(volume) {
	var value = getValue(volume, this.dim);
	var bitsAfter = getNumBits(volume, this.numDims, this.dim) - this.bitsBefore;
	return new PathIter(this.numDims, volume, this.dim, value, this.bitsBefore, bitsAfter);
};

// returns the volume *before* the last call to nextPath()
PathIter.prototype.prevVolume = function() {
	var prev = this.volume.slice();
	var numDims = this.numDims;
	setNumBits(prev, this.dim, numDims, this.bitsBefore);
	for (var dim = this.dim + 1; dim < numDims; dim++) {
		setNumBits(prev, dim, numDims, 0);
	}
	return prev;
};

function makePathIter(numDims, volume) {
	return new PathIter(numDims, volume, -1, null, 0, 0);
}

// BRANCHES

function makeBranch(numChildren) {
	var branch = buffer.slice(0, 2 + numChildren);
	branch[0] = BRANCH;
	branch[1] = 0;
	return branch;
}

function population(v) {
	var c;
	c = v - ((v >> 1) & 0x55555555);
	c = ((c >> 2) & 0x33333333) + (c & 0x33333333);
	c = ((c >> 4) + c) & 0x0F0F0F0F;
	c = ((c >> 8) + c) & 0x00FF00FF;
	c = ((c >> 16) + c) & 0x0000FFFF;
	return c;
}

function getEntries(branch) {
	return branch[1];
}

function getChild(branch, path) {
	var entries = branch[1];
	var ix = population(entries >> (path + 1));
	return branch[2 + ix];
}

function replaceChild(branch, path, child) {
	var entries = branch[1];
	var ix = population(entries >> (path + 1));
	branch[2 + ix] = child;
}

function insertChild(branch, path, child) {
	var entries = branch[1];
	for (var ix = population(entries >> (path + 1)), numIxes = population(entries); ix < numIxes; ix++) {
		var tmp = branch[2 + ix];
		branch[2 + ix] = child;
		child = tmp;
	}
	branch[2 + numIxes] = child;
	branch[1] = entries | (1 << path);
}

// TREES

function QQTree(numDims, root) {
	this.numDims = numDims;
	this.root = root;
}

function insert(parent, parentPath, node, pathIter) {
	switch (getTag(node)) {
		case BRANCH:
			var path = pathIter.nextPath();
			var entries = getEntries(node);
			if (path !== END_OF_PATH) {
				if (entries & (1 << path)) {
					var child = getChild(node, path);
					insert(node, path, child, pathIter);
				} else {
					insertChild(node, path, pathIter.volume);
				}
			} else {
				throw "Unexpected end of path";
			}
			break;

		case VOLUME:
			var child = makeBranch(2);
			replaceChild(parent, parentPath, child);
			insert(parent, parentPath, child, pathIter.copy(node));
			insert(parent, parentPath, child, pathIter);
			break;
	}
}

QQTree.prototype.insert = function(volume) {
	insert(this.root, 0, this.root, makePathIter(this.numDims, volume));
	return this;
};

QQTree.prototype.inserts = function(volumes) {
	for (var i = 0, len = volumes.length; i < len; i++) {
		insert(this.root, 0, this.root, makePathIter(this.numDims, volumes[i]));
	}
	return this;
};

function makeQQTree(numDims) {
	return new QQTree(numDims, makeBranch(2));
}

// TESTS

function slowPopulation(v) {
	var c = 0;
	for (var i = 0; i < 32; i++) {
		c += (v >> i) & 1;
	}
	return c;
}

function testPopulation(n) {
	for (var i = 0; i < n; i++) {
		var v = (Math.random() * Math.pow(2, 32)) | 0;
		if (population(v) !== slowPopulation(v)) throw ("Failed on " + v);
	}
}

function bits(n) {
	var s = "";
	for (var i = 31; i >= 0; i--) {
		s += (n >> i) & 1;
	}
	return s;
}

// BENCH

function index(facts, ix) {
	var index = {};
	for (var i = 0, len = facts.length; i < len; i++) {
		var fact = facts[i];
		var value = fact[ix];
		var bucket = index[value] || (index[value] = []);
		bucket.push(fact);
	}
	return index;
}

function lookup(facts, ix, index) {
	var results = [];
	for (var i = 0, factsLen = facts.length; i < factsLen; i++) {
		var fact = facts[i];
		var value = fact[ix];
		var bucket = index[value];
		if (bucket !== undefined) {
			for (var j = 0, bucketLen = bucket.length; j < bucketLen; j++) {
				results.push(fact.concat(bucket[j]));
			}
		}
	}
	return results;
}

function numNodes(tree) {
	var branches = 0;
	var volumes = 0;
	var children = new Int32Array(33);
	var nodes = [tree.root];
	while (nodes.length > 0) {
		var node = nodes.pop();
		switch (getTag(node)) {
			case BRANCH:
				var numChildren = 0;
				branches += 1;
				for (var i = 0, max = node.length - 2; i < max; i++) {
					var child = node[2 + i];
					numChildren += 1;
					nodes.push(child);
				}
				children[numChildren] += 1;
				break;

			case VOLUME:
				volumes += 1;
		}
	}
	return {
		volumes: volumes,
		branches: branches,
		children: children
	};
}

function benchQQ(users, logins, bans) {
	console.time("insert");
	console.profile();
	var usersTree = makeQQTree(2).inserts(users);
	var loginsTree = makeQQTree(2).inserts(logins);
	var bansTree = makeQQTree(1).inserts(bans);
	//console.profileEnd();
	console.timeEnd("insert");
	//console.log(numNodes(usersTree), numNodes(loginsTree), numNodes(bansTree));
	//console.log(usersTree, loginsTree, bansTree);
	console.time("solve");
	//console.profile();
	var results = [];
	//console.profileEnd();
	console.timeEnd("solve");
	return results.length;
}

function benchForward(users, logins, bans) {
	console.time("insert forward");
	var loginsIndex = index(logins, 0);
	var bansIndex = index(bans, 0);
	console.timeEnd("insert forward");
	console.time("solve forward");
	var results = lookup(lookup(users, 1, loginsIndex), 3, bansIndex);
	console.timeEnd("solve forward");

	return results.length;
}

function benchBackward(users, logins, bans) {
	console.time("insert backward");
	var usersIndex = index(users, 1);
	var loginsIndex = index(logins, 1);
	console.timeEnd("insert backward");
	console.time("solve backward");
	var results = lookup(lookup(bans, 0, loginsIndex), 1, usersIndex);
	console.timeEnd("solve backward");

	return results.length;
}

function bench(numUsers, numLogins, numBans) {
	var users = [];
	for (var i = 0; i < numUsers; i++) {
		var email = m3_hash_int(i);
		var user = m3_hash_int(i);
		users.push([0, email, user, 32, 32]);
	}
	var logins = [];
	for (var i = 0; i < numLogins; i++) {
		var user = m3_hash_int(Math.floor(Math.random() * numUsers));
		var ip = m3_hash_int(i);
		logins.push([0, user, ip, 32, 32]);
	}
	var bans = [];
	for (var i = 0; i < numBans; i++) {
		var ip = m3_hash_int(i);
		bans.push([0, ip, 32]);
	}

	var results = [];
	results.push(benchQQ(users, logins, bans));
	//results.push(benchForward(users, logins, bans));
	//results.push(benchBackward(users, logins, bans));

	return results;
}

// --- from cljs.core ---

function int_rotate_left(x, n) {
	return ((x << n) | (x >>> (-n)));
}

var m3_seed = 0;
var m3_C1 = 3432918353;
var m3_C2 = 461845907;

function m3_mix_K1(k1) {
	return Math.imul(int_rotate_left(Math.imul(k1, m3_C1), (15)), m3_C2);
}

function m3_mix_H1(h1, k1) {
	return (Math.imul(int_rotate_left((h1 ^ k1), (13)), (5)) + (3864292196));
}

function m3_fmix(h1, len) {
	var h1__$1 = h1;
	var h1__$2 = (h1__$1 ^ len);
	var h1__$3 = (h1__$2 ^ (h1__$2 >>> (16)));
	var h1__$4 = Math.imul(h1__$3, (2246822507));
	var h1__$5 = (h1__$4 ^ (h1__$4 >>> (13)));
	var h1__$6 = Math.imul(h1__$5, (3266489909));
	var h1__$7 = (h1__$6 ^ (h1__$6 >>> (16)));
	return h1__$7;
}

function m3_hash_int(in$) {
	var k1 = m3_mix_K1(in$);
	var h1 = m3_mix_H1(m3_seed, k1);
	return m3_fmix(h1, (4));
}

function hash_string(s) {
	var hash = 0;
	for (var i = 0, len = s.length; i < len; i++) {
		hash = Math.imul(31, hash) + s.charCodeAt(i);
	}
	return hash;
}

function hash(o) {
	if (typeof o === 'number') {
		return Math.floor(o) % 2147483647;
	} else if (typeof o === 'string') {
		return m3_hash_int(hash_string(o));
	} else if (o === true) {
		return 1;
	} else if (o === false) {
		return 0;
	} else {
		throw new Error("Cannot hash: " + typeof(o) + " " + o);
	}
}

// --- end of cljs.core ---