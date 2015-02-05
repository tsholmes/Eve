var buffer = [];
for (var i = 0; i < 1000; i++) {
	buffer[i] = 0;
}

var VOLUME = 0;
var BRANCH = 1;

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

PathIter.prototype.next = function() {
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
			throw "End of path!";
		}
	}
	return getPath(this.value, this.bitsBefore, this.bitsAfter);
};

PathIter.prototype.copy = function(volume) {
	var value = getValue(volume, this.dim);
	var bitsAfter = getNumBits(volume, this.numDims, this.dim) - this.bitsBefore;
	return new PathIter(this.numDims, volume, this.dim, value, this.bitsBefore, bitsAfter);
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
			var path = pathIter.next();
			var entries = getEntries(node);
			if (entries & (1 << path)) {
				var child = getChild(node, path);
				insert(node, path, child, pathIter);
			} else {
				insertChild(node, path, pathIter.volume);
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