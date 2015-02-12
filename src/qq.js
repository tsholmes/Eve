var buffer = [];
for (var i = 0; i < 1000; i++) {
	buffer[i] = 0;
}

var VOLUME = 0;
var BRANCH = 1;

var END_OF_PATH = ["End of path"];

var NO_GAP = ["No gap"];

var NO_COVER = ["No cover"];

var NO_UNCOVERED = ["No uncovered"];

function getTag(node) {
	return node[0];
}

// VOLUMES

function makeVolume(numDims) {
	return buffer.slice(0, 1 + (2 * numDims));
}

function makePoint(numDims) {
	var point = makeVolume(numDims);
	for (var dim = 0; dim < numDims; dim++) {
		setNumBits(point, numDims, dim, 32);
	}
	return point;
}

function getValue(volume, dim) {
	return volume[1 + dim];
}

function getNumBits(volume, numDims, dim) {
	return volume[1 + numDims + dim];
}

function setValue(volume, dim, value) {
	volume[1 + dim] = value;
}

function setNumBits(volume, numDims, dim, numBits) {
	volume[1 + numDims + dim] = numBits;
}

function containsDim(numDims, dim, volume, point) {
	var volumeNumBits = getNumBits(volume, numDims, dim);
	var pointNumBits = getNumBits(point, numDims, dim);
	if (volumeNumBits > pointNumBits) return false;
	var volumeValue = getValue(volume, dim);
	var pointValue = getValue(point, dim);
	var mask = -Math.pow(2, 32 - volumeNumBits);
	if ((volumeValue & mask) !== (pointValue & mask)) return false;
	return true;
}

function contains(numDims, volume, point) {
	for (var dim = 0; dim < numDims; dim++) {
		if (containsDim(numDims, dim, volume, point) === false) return false;
	}
	return true;
}

// PATH ITERS
// pathIter is (dim, chunkStart) packed into a int so we don't have to stack allocate

var pathMult = Math.pow(2, 32);

function makePathIter(dim, chunkStart) {
	return (dim * pathMult) + chunkStart;
}

function getDim(pathIter) {
	return (pathIter / pathMult) | 0;
}

function getChunkStart(pathIter) {
	return pathIter | 0;
}

function getPath(pathIter, volume, numDims) {
	var dim = getDim(pathIter);
	var chunkStart = getChunkStart(pathIter);
	var numBits = getNumBits(volume, numDims, dim);
	var chunkEnd = Math.min(chunkStart + 4, numBits);
	var chunkBits = chunkEnd - chunkStart;
	var chunkMask = ((1 << chunkBits) - 1);
	var chunk = (getValue(volume, dim) >> (32 - chunkEnd)) & chunkMask;
	// stagger path so that there is space for all combinations of 0-4 bit chunks
	return 32 - chunk - (1 << chunkBits);
}

function nextDim(pathIter, volume, numDims) {
	var dim = getDim(pathIter);
	if (dim < numDims) {
		return makePathIter(dim + 1, 0);
	} else {
		return END_OF_PATH;
	}
}

function nextChunk(pathIter, volume, numDims) {
	var dim = getDim(pathIter);
	var chunkStart = getChunkStart(pathIter);
	var numBits = getNumBits(volume, numDims, dim);
	chunkStart += 4;
	if (chunkStart <= numBits) {
		return makePathIter(dim, chunkStart);
	} else {
		if (dim < numDims) {
			return makePathIter(dim + 1, 0);
		} else {
			return END_OF_PATH;
		}
	}
}

function isPartial(pathBit) {
	return (pathBit >> 17) !== 0; // ie chunk was < 4 bits
}

function getEnclosingVolume(pathIter, volume, numDims) {
	var dim = getDim(pathIter);
	var chunkStart = getChunkStart(pathIter);
	var enclosingVolume = volume.slice();
	var numBits = Math.min(chunkStart + 4, getNumBits(enclosingVolume, numDims, dim));
	setValue(enclosingVolume, dim, getValue(enclosingVolume, dim) & -Math.pow(2, 32 - numBits));
	setNumBits(enclosingVolume, numDims, dim, numBits);
	for (var unusedDim = dim + 1; unusedDim < numDims; unusedDim++) {
		setValue(enclosingVolume, unusedDim, 0);
		setNumBits(enclosingVolume, numDims, unusedDim, 0);
	}
	return enclosingVolume;
}

var CHUNK_BITS = [];
for (var chunkBits = 0; chunkBits < 5; chunkBits++) {
	for (var chunk = 0; chunk < Math.pow(2, chunkBits); chunk++) {
		var path = chunk + (1 << chunkBits) - 1;
		CHUNK_BITS[path] = chunkBits;
	}
}

// all paths which are a prefix of this path
var PREFIXES = [];
for (var chunkBits = 0; chunkBits < 5; chunkBits++) {
	for (var chunk = 0; chunk < Math.pow(2, chunkBits); chunk++) {
		var path = 32 - chunk - (1 << chunkBits);
		var matches = 0;

		for (var matchingChunkBits = 0; matchingChunkBits < 5; matchingChunkBits++) {
			for (var matchingChunk = 0; matchingChunk < Math.pow(2, matchingChunkBits); matchingChunk++) {
				var matchingPath = 32 - matchingChunk - (1 << matchingChunkBits);
				if ((chunkBits >= matchingChunkBits) &&
					((chunk >> (chunkBits - matchingChunkBits)) === matchingChunk)) {
					matches = matches | (1 << matchingPath);
				}
			}
		}

		PREFIXES[path] = matches;
	}
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

function getIx(entries, pathBit) {
	return population(entries & (pathBit ^ -pathBit));
}

function getEntries(branch) {
	return branch[1];
}

function getChild(branch, pathBit) {
	var entries = branch[1];
	var ix = getIx(entries, pathBit);
	return branch[2 + ix];
}

function replaceChild(branch, pathBit, child) {
	var entries = branch[1];
	var ix = getIx(entries, pathBit);
	branch[2 + ix] = child;
}

function insertChild(branch, pathBit, child) {
	var entries = branch[1];
	for (var ix = getIx(entries, pathBit), numIxes = population(entries); ix < numIxes; ix++) {
		var tmp = branch[2 + ix];
		branch[2 + ix] = child;
		child = tmp;
	}
	branch[2 + numIxes] = child;
	branch[1] = entries | pathBit;
}

// TREES

function QQTree(numDims, root) {
	this.numDims = numDims;
	this.root = root;
}

function insert(parent, parentPath, node, volume, numDims) {
	var pathIter = makePathIter(0, 0);
	while (true) {
		switch (getTag(node)) {
			case BRANCH:
				var path = getPath(pathIter, volume, numDims);
				var entries = getEntries(node);
				if ((entries & (1 << path)) !== 0) {
					parent = node;
					parentPath = path;
					node = getChild(node, 1 << path);
					pathIter = nextChunk(pathIter, volume, numDims);
					if (pathIter === END_OF_PATH) return; // already inserted
				} else {
					insertChild(node, 1 << path, volume);
					return;
				}
				break;

			case VOLUME:
				var tmp = node;
				node = makeBranch(2);
				replaceChild(parent, 1 << parentPath, node);
				insertChild(node, 1 << getPath(pathIter, tmp, numDims), tmp);
				break;
		}
	}
}

QQTree.prototype.insert = function(volume) {
	insert(this.root, 0, this.root, volume, this.numDims);
	return this;
};

QQTree.prototype.inserts = function(volumes) {
	for (var i = 0, len = volumes.length; i < len; i++) {
		insert(this.root, 0, this.root, volumes[i], this.numDims);
	}
	return this;
};

function makeQQTree(numDims) {
	return new QQTree(numDims, makeBranch(2));
}

// SEARCHING

// find maximum gap, given a tree of points and a search point
// TODO this is somewhat lazy - we always give chunk-aligned gaps when we could sometimes do better
//      instead, when we find a gap we should try less bits until we find a tight gap
function findGap(node, volume, numDims) {
	var pathIter = makePathIter(0, 0);
	while (true) {
		switch (getTag(node)) {
			case BRANCH:
				var path = getPath(pathIter, volume, numDims);
				var entries = getEntries(node);
				if ((entries & (1 << path)) !== 0) {
					node = getChild(node, 1 << path);
					pathIter = nextChunk(pathIter, volume, numDims);
					if (pathIter === END_OF_PATH) return NO_GAP;
				} else {
					return getEnclosingVolume(pathIter, volume, numDims);
				}
				break;

			case VOLUME:
				while (true) {
					if (getPath(pathIter, volume, numDims) !== getPath(pathIter, node, numDims)) {
						return getEnclosingVolume(pathIter, volume, numDims);
					}
					pathIter = nextChunk(pathIter, volume, numDims);
					if (pathIter === END_OF_PATH) return NO_GAP;
				}
		}
	}
}

// NOTE numDims may be less than this.numDims if we don't care about the trailing values in the index
QQTree.prototype.findGap = function(volume, numDims) {
	if (numDims > this.numDims) throw "Too many dims!";
	return findGap(this.root, volume, numDims);
};

// TODO which cover should we prefer?
function findCover(node, numDims, volume) {
	var pathIter = makePathIter(0, 0);
	var stack = [node, pathIter];
	nextNode: while (true) {
		if (stack.length === 0) return NO_COVER;
		pathIter = stack.pop();
		node = stack.pop();
		handleNode: switch (getTag(node)) {
			case BRANCH:
				if (pathIter === END_OF_PATH) continue nextNode;
				var path = getPath(pathIter, volume, numDims);
				var matches = getEntries(node) & PREFIXES[path];
				while (matches !== 0) {
					var pathBit = matches & -matches; // smallest one bit
					matches = matches & ~pathBit; // pop path
					var child = getChild(node, pathBit);
					var childPathIter = isPartial(pathBit) ? nextDim(pathIter, volume, numDims) : nextChunk(pathIter, volume, numDims);
					stack.push(child, childPathIter);
				}
				break;

			case VOLUME:
				for (var dim = getDim(pathIter); dim < numDims; dim++) {
					if (containsDim(numDims, dim, node, volume) === false) continue nextNode;
				}
				return node;
		}
	}
}

QQTree.prototype.findCover = function(volume) {
	return findCover(this.root, this.numDims, volume);
};

// requires that volumeA and volumeB have a common suffix
function resolve(volumeA, volumeB, numDims, mergeDim) {
	var volume = makeVolume(numDims);
	for (var dim = 0; dim < numDims; dim++) {
		var numBitsA = getNumBits(volumeA, numDims, dim);
		var numBitsB = getNumBits(volumeB, numDims, dim);
		if (numBitsA > numBitsB) {
			setValue(volume, dim, getValue(volumeA, dim));
			setNumBits(volume, numDims, dim, numBitsA);
		} else {
			setValue(volume, dim, getValue(volumeB, dim));
			setNumBits(volume, numDims, dim, numBitsB);
		}
	}
	var numBits = getNumBits(volumeA, numDims, mergeDim) - 1;
	setValue(volume, mergeDim, getValue(volumeA, mergeDim) & -Math.pow(2, 32 - numBits));
	setNumBits(volume, numDims, mergeDim, numBits);
	// console.log("Resolved", JSON.stringify(volumeA), JSON.stringify(volumeB), JSON.stringify(volume));
	return volume;
}

function escape(volume, numDims) {
	for (var dim = 0; dim < numDims; dim++) {
		var numBits = getNumBits(volume, numDims, dim);
		if (numBits > 0) {
			return makePathIter(dim, numBits);
		}
	}
	return makePathIter(0, 0);
}

function getBit(pathIter, volume) {
	var dim = getDim(pathIter);
	var numBits = getChunkStart(pathIter);
	var value = getValue(volume, dim);
	return (value >> (32 - numBits)) & 1;
}

function setBit(pathIter, volume, numDims) {
	var dim = getDim(pathIter);
	var numBits = getChunkStart(pathIter);
	var value = getValue(volume, dim);
	value = value & -Math.pow(2, 32 - numBits); // clear lower bits
	value = value | (1 << (32 - numBits)); // set the escaping bit
	setValue(volume, dim, value);
	for (dim = dim - 1; dim >= 0; dim--) {
		setValue(volume, dim, 0);
	}
}

function findUncovered(provenance, numDims) {
	var point = makePoint(numDims);
	var cover = provenance.findCover(point);
	if (cover === NO_COVER) return point;
	var stack = [];
	while (true) {
		var pathIter = escape(cover, numDims);
		if (pathIter === 0) return NO_UNCOVERED;
		var lastBit = getBit(pathIter, cover);
		if (lastBit === 0) {
			stack.push(cover);
			setBit(pathIter, point, numDims);
			var cover = provenance.findCover(point);
			if (cover === NO_COVER) return point;
		} else {
			var dim = getDim(pathIter);
			var numBits = getChunkStart(pathIter);
			var prevCover;
			do {
				prevCover = stack.pop();
			} while (getNumBits(prevCover, numDims, dim) !== numBits);
			cover = resolve(cover, prevCover, numDims, dim);
			provenance.insert(cover);
		}
	}
}

// SOLVING

function QQConstraint(index, variables) {
	this.index = index;
	this.variables = variables;
	this.point = makePoint(variables.length);
}

QQConstraint.prototype.findGap = function(solverDims, solverPoint) {
	var variables = this.variables;
	var point = this.point;
	for (var dim = 0, numDims = variables.length; dim < numDims; dim++) {
		setValue(point, dim, getValue(solverPoint, variables[dim]));
	}
	var gap = this.index.findGap(point, numDims);
	if (gap === NO_GAP) return NO_GAP;
	var solverGap = makeVolume(solverDims);
	for (var dim = 0; dim < numDims; dim++) {
		setValue(solverGap, variables[dim], getValue(gap, dim));
		setNumBits(solverGap, solverDims, variables[dim], getNumBits(gap, numDims, dim));
	}
	return solverGap;
};

function solve(numDims, constraints, provenance) {
	var results = [];
	while (true) {
		var point = findUncovered(provenance, numDims);
		if (point === NO_UNCOVERED) return results;
		var isResult = true;
		for (var constraint = 0, numConstraints = constraints.length; constraint < numConstraints; constraint++) {
			var gap = constraints[constraint].findGap(numDims, point);
			if (gap !== NO_GAP) {
				isResult = false;
				provenance.insert(gap);
			}
		}
		if (isResult === true) {
			results.push(point);
			provenance.insert(point);
		}
	}
}

// BENCHMARKS

function index(as, ix) {
	var index = {};
	for (var i = 0, len = as.length; i < len; i++) {
		var a = as[i];
		var value = a[ix];
		var bucket = index[value] || (index[value] = []);
		bucket.push(a);
	}
	return index;
}

function lookup(as, ix, index) {
	var results = [];
	for (var i = 0, asLen = as.length; i < asLen; i++) {
		var a = as[i];
		var value = a[ix];
		var bucket = index[value];
		if (bucket !== undefined) {
			for (var j = 0, bucketLen = bucket.length; j < bucketLen; j++) {
				results.push(a.concat(bucket[j]));
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
	// console.profile();
	var usersTree = makeQQTree(2).inserts(users);
	var loginsTree = makeQQTree(2).inserts(logins);
	var bansTree = makeQQTree(1).inserts(bans);
	// console.profileEnd();
	console.timeEnd("insert");
	// console.log(numNodes(usersTree), numNodes(loginsTree), numNodes(bansTree));
	// console.log(usersTree, loginsTree, bansTree);
	console.time("solve");
	// console.profile();
	var results = solve(3, [
		new QQConstraint(usersTree, [0, 1]),
		new QQConstraint(loginsTree, [1, 2]),
		new QQConstraint(bansTree, [2])
	], makeQQTree(3));
	// console.profileEnd();
	console.timeEnd("solve");
	return results;
}

function benchForward(users, logins, bans) {
	// console.time("insert forward");
	var loginsIndex = index(logins, 0);
	var bansIndex = index(bans, 0);
	// console.timeEnd("insert forward");
	// console.time("solve forward");
	var results = lookup(lookup(users, 1, loginsIndex), 3, bansIndex);
	// console.timeEnd("solve forward");

	return results.length;
}

function benchBackward(users, logins, bans) {
	// console.time("insert backward");
	var usersIndex = index(users, 1);
	var loginsIndex = index(logins, 1);
	// console.timeEnd("insert backward");
	// console.time("solve backward");
	var results = lookup(lookup(bans, 0, loginsIndex), 1, usersIndex);
	// console.timeEnd("solve backward");

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

// TESTS

QQTree.prototype.volumes = function() {
	var volumes = [];
	var nodes = [this.root];
	while (nodes.length > 0) {
		var node = nodes.pop();
		switch (getTag(node)) {
			case BRANCH:
				for (var i = 0, max = node.length - 2; i < max; i++) {
					nodes.push(node[2 + i]);
				}
				break;

			case VOLUME:
				volumes.push(node);
		}
	}
	return volumes;
};

var bigcheck = bigcheck; // make jshint happy

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

function sameValue(a, b) {
	if (typeof(a) !== typeof(b)) return false;
	if (Array.isArray(a)) {
		if (a.length !== b.length) return false;
		for (var i = 0; i < a.length; i++) {
			if (sameValue(a[i], b[i]) === false) return false;
		}
		return true;
	} else {
		return (a === b);
	}
}

function dedupe(as) {
	var len = as.length;
	if (len === 0) return [];
	as.sort();
	var next = as[0];
	var last;
	var deduped = [next];
	for (var i = 1; i < len; i++) {
		last = next;
		next = as[i];
		if (sameValue(last, next) === false) {
			deduped.push(next);
		}
	}
	return deduped;
}

function sameContents(a, b) {
	return sameValue(dedupe(a), dedupe(b));
}


function randomBits() {
	return (Math.random() * Math.pow(2, 32)) | 0;
}

bigcheck.point = function(numDims) {
	return new bigcheck.Generator(
		function tupleGrow(size) {
			var volume = makeVolume(numDims);
			for (var dim = 0; dim < numDims; dim++) {
				setValue(volume, dim, randomBits());
				setNumBits(volume, dim, numDims, 32);
			}
			return volume;
		},
		function tupleShrink(volume, bias) {
			volume = volume.slice();
			var dim = Math.floor(Math.random() * numDims);
			var value = getValue(volume, dim);
			var mask = -(value & -value);
			setValue(volume, dim, randomBits() & mask);
			return volume;
		});
};

bigcheck.volume = function(numDims) {
	return new bigcheck.Generator(
		function tupleGrow(size) {
			var volume = [0];
			for (var dim = 0; dim < numDims; dim++) {
				var numBits = (Math.random() * Math.min(size, 32)) | 0;
				var value = randomBits() & -Math.pow(2, 32 - numBits);
				setValue(volume, dim, value);
				setNumBits(volume, dim, numDims, numBits);
			}
			return volume;
		},
		function tupleShrink(volume, bias) {
			volume = volume.slice();
			var dim = Math.floor(Math.random() * numDims);
			if (Math.random() > 0.5) {
				var value = getValue(volume, dim);
				var mask = -(value & -value);
				setValue(volume, dim, randomBits(32) & mask);
			} else {
				var numBits = (Math.random() * getNumBits(volume, numDims, dim)) | 0;
				var value = getValue(volume, dim) & -Math.pow(2, 32 - numBits);
				setValue(volume, dim, value);
				setNumBits(volume, dim, numDims, numBits);
			}
			return volume;
		});
};

var testDims = 3;

var testInserts =
	bigcheck.foralls("Trees don't lose volumes",
		bigcheck.array(bigcheck.volume(testDims)),
		function(volumes) {
			var qq = makeQQTree(testDims).inserts(volumes);
			var outVolumes = qq.volumes();
			return sameContents(volumes, outVolumes);
		});

var testFindGap =
	bigcheck.foralls("findGap returns a gap",
		bigcheck.array(bigcheck.point(testDims)),
		bigcheck.point(testDims),
		function(points, point) {
			var qq = makeQQTree(testDims).inserts(points);
			// TODO test with less dims
			var gap = qq.findGap(point, testDims);
			if (gap === NO_GAP) {
				// point exists in points
				return points.some(function(other) {
					return sameValue(point, other);
				});
			} else {
				// gap covers point and nothing else
				// TODO test that gap is maximal ie reducing the numBits makes it cover something in points
				return contains(testDims, gap, point) && !points.some(function(other) {
					return contains(testDims, gap, other);
				});
			}
		});

var testFindCover =
	bigcheck.foralls("findCover returns a maximal cover",
		bigcheck.array(bigcheck.volume(testDims)),
		bigcheck.point(testDims),
		function(volumes, point) {
			var qq = makeQQTree(testDims).inserts(volumes);
			var cover = qq.findCover(point);
			if (cover === NO_COVER) {
				// no volumes cover the point
				return !volumes.some(function(other) {
					return contains(testDims, other, point);
				});
			} else {
				// cover covers the point, is from the volumes list and is maximal
				return contains(testDims, cover, point) && volumes.some(function(other) {
					return sameValue(other, cover);
				}) && !volumes.some(function(other) {
					return !sameValue(other, cover) && contains(testDims, other, cover);
				});
			}
		});

var testFindUncovered =
	bigcheck.foralls("findUncovered returns an uncovered point if one exists",
		bigcheck.array(bigcheck.volume(testDims)),
		bigcheck.point(testDims),
		function(volumes, point) {
			var qq = makeQQTree(testDims).inserts(volumes);
			var uncovered = findUncovered(qq, testDims);
			if (uncovered === NO_UNCOVERED) {
				// there are no uncovered points, so the test point must be covered
				// TODO test resolution is whole space
				return volumes.some(function(other) {
					return contains(testDims, other, point);
				});
			} else {
				// no volumes cover the point
				return !volumes.some(function(other) {
					return contains(testDims, other, uncovered);
				});
			}
		});

function test() {
	testInserts.check({
		maxTests: 1000,
		maxSize: 1000,
	});
	testFindGap.check({
		maxTests: 100000,
		maxSize: 1000,
	});
	testFindCover.check({
		maxTests: 100000,
		maxSize: 1000,
	});
	testFindUncovered.check({
		maxTests: 10000,
		maxSize: 1000,
	});
}

// test();