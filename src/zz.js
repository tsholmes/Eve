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

function withHashes(values) {
  var hashesAndValues = new Array(2 * values.length);
  for (var i = 0, len = values.length; i < len; i++) {
    var value = values[i];
    hashesAndValues[i] = hash(value);
    hashesAndValues[len + i] = value;
  }
  return hashesAndValues;
}

function ZZTree(numValues, ixes, root) {
  this.numValues = numValues;
  this.ixes = ixes;
  this.root = root;
}

ZZTree.prototype.isBranch = function(node) {
  return node.length === 17; // leaves include hashes and values so are always an even length
};

// branch layout is 16 * childPointer, 1 * version
ZZTree.prototype.emptyBranch = function() {
  var branch = new Array(17);
  branch[16] = 0;
  return branch;
};

function nibble(hash, i) {
  return (hash >> (28 - (4 * i))) & 15;
}

// the path interleaves nibbles from each of the hashes
ZZTree.prototype.pathAt = function(hashesAndValues, depth) {
  var ixes = this.ixes;
  var numIxes = ixes.length;
  var hash = hashesAndValues[ixes[depth % numIxes]];
  return nibble(hash, (depth / numIxes) | 0);
};

ZZTree.prototype.insertAt = function(branch, depth, hashesAndValues) {
  var path = this.pathAt(hashesAndValues, depth);
  var child = branch[path];
  if (child === undefined) {
    branch[path] = hashesAndValues;
    branch[16] = branch[16] | (1 << path);
  } else if (this.isBranch(child)) {
    this.insertAt(child, depth + 1, hashesAndValues);
  } else {
    var newBranch = this.emptyBranch();
    branch[path] = newBranch;
    this.insertAt(newBranch, depth + 1, hashesAndValues);
    this.insertAt(newBranch, depth + 1, child);
  }
};

ZZTree.prototype.insert = function(values) {
  this.insertAt(this.root, 0, withHashes(values));
  return this;
};

ZZTree.prototype.inserts = function(valuess) {
  for (var i = 0, len = valuess.length; i < len; i++) {
    this.insert(valuess[i]);
  }
  return this;
};

ZZTree.prototype.probeLeaf = function(node, depth, maxDepth, hashes) {
  var numBits = 4 * (maxDepth / hashes.length);
  var ixes = this.ixes;
  for (var i = 0, len = ixes.length; i < len; i++) {
    var ix = ixes[i];
    var nodeBits = node[ix] >> (32 - numBits);
    var hashBits = hashes[i] >> (32 - numBits);
    if (nodeBits !== hashBits) return 0;
  }
  return 1;
};

// the path interleaves nibbles from each of the hashes
ZZTree.prototype.probePathAt = function(hashes, depth) {
  var ixes = this.ixes;
  var numIxes = ixes.length;
  var hash = hashes[depth % numIxes];
  return nibble(hash, (depth / numIxes) | 0);
};

ZZTree.prototype.probeIn = function(node, depth, maxDepth, hashes) {
  if (depth === maxDepth) {
    return 2;
  } else if (!this.isBranch(node)) {
    return this.probeLeaf(node, depth, maxDepth, hashes);
  } else {
    var path = this.probePathAt(hashes, depth);
    var child = node[path];
    if (child === undefined) {
      return 0;
    } else {
      return this.probeIn(child, depth + 1, maxDepth, hashes);
    }
  }
};

ZZTree.prototype.probe = function(maxDepth, hashes) {
  return this.probeIn(this.root, 0, maxDepth, hashes);
};

ZZTree.empty = function(numValues, ixes) {
  var tree = new ZZTree(numValues, ixes, null);
  tree.root = tree.emptyBranch();
  return tree;
};

// SOLVER

function ZZContains(tree, ixes) {
  this.tree = tree;
  this.ixes = ixes; // maps from tree values to solver values
}

ZZContains.prototype.probe = function(numNibbles, values) {
  var ixes = this.ixes;
  var treeValues = new Array(ixes.length);
  for (var i = 0, len = ixes.length; i < len; i++) {
    treeValues[i] = values[ixes[i]];
  }
  return this.tree.probe(numNibbles * ixes.length, treeValues);
};

function solveIn(constraints, numConstraints, numVariables, values, numNibbles, results) {
  var cardinality = 1;
  for (var i = 0; i < numConstraints; i++) {
    cardinality *= constraints[i].probe(numNibbles, values);
    if (cardinality === 0) {
      return; // no solutions here
    }
  }
  if (cardinality === 1) {
    results.push(values.slice()); // found a solution
  } else {
    // TODO only allows for 8 values
    for (var i = 0, max = Math.pow(16, numVariables); i < max; i++) {
      for (var j = 0; j < numVariables; j++) {
        var value = values[j];
        value = value & -Math.pow(2, 32 - 4 * numNibbles); // clear remaining bits, ridiculous that js cant do this with bit shifts
        var nibble = (i >> (4 * j)) & 15; // grab the correct nibble for this permutation
        value = value | (nibble << (28 - 4 * numNibbles)); // set the nibble
        values[j] = value;
      }
      solveIn(constraints, numConstraints, numVariables, values, numNibbles + 1, results);
    }
  }
}

function solve(constraints, numVariables) {
  var values = new Array(numVariables);
  for (var i = 0; i < numVariables; i++) {
    values[i] = 0;
  }
  var results = [];
  solveIn(constraints, constraints.length, numVariables, values, 0, results);
  return results;
}

// STUFF

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
  var leaves = 0;
  var children = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  var nodes = [tree.root];
  while (nodes.length > 0) {
    var node = nodes.pop();
    if (tree.isBranch(node)) {
      var numChildren = 0;
      branches += 1;
      for (var i = 0; i < 16; i++) {
        var child = node[i];
        if (child !== undefined) {
          numChildren += 1;
          nodes.push(child);
        }
      }
      children[numChildren] += 1;
    } else {
      leaves += 1;
    }
  }
  return {
    leaves: leaves,
    branches: branches,
    children: children
  };
}

function bench(numUsers, numLogins, numBans) {
  var users = [];
  for (var i = 0; i < numUsers; i++) {
    var email = i;
    var user = i;
    users.push(["email" + email, "user" + user]);
  }
  var logins = [];
  for (var i = 0; i < numLogins; i++) {
    var user = Math.floor(Math.random() * numUsers);
    var ip = i;
    logins.push(["user" + user, "ip" + ip]);
  }
  var bans = [];
  for (var i = 0; i < numBans; i++) {
    var ip = i;
    bans.push(["ip" + ip]);
  }

  console.time("insert");
  var usersTree = ZZTree.empty(2, [1]).inserts(users);
  var loginsTree = ZZTree.empty(2, [0, 1]).inserts(logins);
  var bansTree = ZZTree.empty(1, [0]).inserts(bans);
  console.timeEnd("insert");
  console.log(numNodes(usersTree), numNodes(loginsTree), numNodes(bansTree));
  console.log(usersTree, loginsTree, bansTree);
  console.time("solve");
  //console.profile();
  var solverResults = solve([
    new ZZContains(usersTree, [0]),
    new ZZContains(loginsTree, [0, 1]),
    new ZZContains(bansTree, [1])
  ], 2);
  //console.profileEnd();
  console.timeEnd("solve");

  console.time("insert forward");
  var loginsIndex = index(logins, 0);
  var bansIndex = index(bans, 0);
  console.timeEnd("insert forward");
  console.time("solve forward");
  var forwardResults = lookup(lookup(users, 1, loginsIndex), 3, bansIndex);
  console.timeEnd("solve forward");

  console.time("insert backward");
  var usersIndex = index(users, 1);
  var loginsIndex = index(logins, 1);
  console.timeEnd("insert backward");
  console.time("solve backward");
  var backwardResults = lookup(lookup(bans, 0, loginsIndex), 1, usersIndex);
  console.timeEnd("solve backward");

  return [solverResults, forwardResults, backwardResults];
}

// var x = bench(1000000);

function bits(n) {
  var s = "";
  for (var i = 31; i >= 0; i--) {
    s += (n >> i) & 1;
  }
  return s;
}