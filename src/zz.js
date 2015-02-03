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

function population(v) {
  var c;
  c = v - ((v >> 1) & 0x55555555);
  c = ((c >> 2) & 0x33333333) + (c & 0x33333333);
  c = ((c >> 4) + c) & 0x0F0F0F0F;
  c = ((c >> 8) + c) & 0x00FF00FF;
  return c & 0x0000FFFF;
}

function slowPopulation(v) {
  var c = 0;
  for (var i = 0; i < 16; i++) {
    c += (v >> i) & 1;
  }
  return c;
}

function testPopulation() {
  for (var i = 0, max = Math.pow(2, 16); i < max; i++) {
    if (population(i) !== slowPopulation(i)) throw ("Failed on " + i);
  }
}

function getNibble(hash, i) {
  return (hash >> (28 - (4 * i))) & 15;
}

function setNibble(hash, i, nibble) {
  var cleared = hash & ~(15 << (28 - (4 * i)));
  return cleared | (nibble << (28 - (4 * i)));
}

function ZZTree(numValues, ixes, root) {
  this.numValues = numValues;
  this.ixes = ixes;
  this.root = root;
}

var BRANCH = 0;
var LEAF = 1;

var buffer = [];
for (var i = 0; i < 1000; i++) {
  buffer[i] = 0;
}

function makeBranch(numChildren) {
  var branch = buffer.slice(0, numChildren);
  branch[0] = BRANCH;
  branch[1] = 0;
  return branch;
}

function makeLeaf(values) {
  var leaf = buffer.slice(0, 1 + (2 * values.length));
  leaf[0] = LEAF;
  for (var i = 0, len = values.length; i < len; i++) {
    var value = values[i];
    leaf[1 + i] = hash(value);
    leaf[1 + len + i] = value;
  }
  return leaf;
}

function getTag(node) {
  return node[0];
}

function getHash(leaf, ix) {
  return leaf[1 + ix];
}

function getEntries(branch) {
  return branch[1];
}

function getChild(branch, path) {
  var entries = branch[1];
  if (entries & (1 << path)) {
    var ix = population(entries << (16 - path));
    return branch[2 + ix];
  } else {
    return undefined;
  }
}

// must be called in ascending path order
function addChild(branch, path, child) {
  var entries = branch[1] | (1 << path);
  branch[1] = entries;
  var ix = population(entries << (16 - path));
  branch[2 + ix] = child;
}

ZZTree.prototype.nibbleSort = function(leaves, depth) {
  var ixes = this.ixes;
  var numIxes = ixes.length;
  var hashIx = ixes[depth % numIxes];
  var nibbleIx = (depth / numIxes) | 0;
  var buckets = [];
  for (var i = 0; i < 16; i++) {
    buckets[i] = [];
  }
  for (var i = 0, len = leaves.length; i < len; i++) {
    var leaf = leaves[i];
    var bucket = getNibble(getHash(leaf, hashIx), nibbleIx);
    buckets[bucket].push(leaf);
  }
  return buckets;
};

ZZTree.prototype.create = function(leaves, depth) {
  if (leaves.length === 1) {
    return leaves[0];
  } else {
    var buckets = this.nibbleSort(leaves, depth);
    var numChildren = 0;
    for (var path = 0; path < 16; path++) {
      var bucket = buckets[path];
      if (bucket.length > 0) {
        numChildren += 1;
      }
    }
    var branch = makeBranch(numChildren);
    for (var path = 0; path < 16; path++) {
      var bucket = buckets[path];
      if (bucket.length > 0) {
        addChild(branch, path, this.create(bucket, depth + 1));
      }
    }
    return branch;
  }
};

ZZTree.prototype.include = function(node, leaves, depth) {
  // TODO dont throw away node
  return this.create(leaves, depth);
};

ZZTree.prototype.insert = function(rows) {
  var leaves = [];
  for (var i = 0, len = rows.length; i < len; i++) {
    leaves.push(makeLeaf(rows[i]));
  }
  var root = this.include(this.root, leaves, 0);
  return new ZZTree(this.numValues, this.ixes, root);
};

ZZTree.prototype.setNextNibblesFromLeaf = function(node, maxDepth, nextNibbles, index2solver) {
  var nextNibble = (maxDepth / index2solver.length) | 0;
  var ixes = this.ixes;
  for (var i = 0, len = index2solver.length; i < len; i++) {
    var nodeIx = ixes[i];
    var solverIx = index2solver[i];
    var nodeValue = getHash(node, nodeIx);
    nextNibbles[solverIx] = nextNibbles[solverIx] & (1 << getNibble(nodeValue, nextNibble));
  }
};

ZZTree.prototype.setNextNibblesFromBranch = function(node, maxDepth, nextNibbles, index2solver) {
  var solverIx = index2solver[maxDepth % index2solver.length];
  nextNibbles[solverIx] = nextNibbles[solverIx] & getEntries(node);
};

ZZTree.prototype.probeLeaf = function(node, depth, maxDepth, nextNibbles, hashes, index2solver) {
  var numBits = 4 * (maxDepth / hashes.length);
  var ixes = this.ixes;
  for (var i = 0, len = ixes.length; i < len; i++) {
    var nodeIx = ixes[i];
    var solverIx = index2solver[i];
    var nodeValue = getHash(node, nodeIx);
    var hashValue = hashes[solverIx];
    if ((nodeValue >> (32 - numBits)) !== (hashValue >> (32 - numBits))) return 0;
  }
  this.setNextNibblesFromLeaf(node, maxDepth, nextNibbles, index2solver);
  return 1;
};

// the path interleaves nibbles from each of the hashes
ZZTree.prototype.probePathAt = function(depth, hashes, index2solver) {
  var numIxes = index2solver.length;
  var hash = hashes[index2solver[depth % numIxes]];
  return getNibble(hash, (depth / numIxes) | 0);
};

ZZTree.prototype.probeIn = function(node, depth, maxDepth, nextNibbles, hashes, index2solver, solver2index) {
  if (depth < maxDepth) {
    switch (getTag(node)) {
      case BRANCH:
        var path = this.probePathAt(depth, hashes, index2solver);
        var child = getChild(node, path);
        if (child === undefined) {
          return 0;
        } else {
          return this.probeIn(child, depth + 1, maxDepth, nextNibbles, hashes, index2solver, solver2index);
        }

      case LEAF:
        return this.probeLeaf(node, depth, maxDepth, nextNibbles, hashes, index2solver);
    }
  } else {
    switch (getTag(node)) {
      case BRANCH:
        this.setNextNibblesFromBranch(node, maxDepth, nextNibbles, index2solver);
        return 2;

      case LEAF:
        this.setNextNibblesFromLeaf(node, maxDepth, nextNibbles, index2solver);
        return 1;
    }
  }
};

ZZTree.prototype.probe = function(numNibbles, nextNibbles, hashes, index2solver, solver2index) {
  return this.probeIn(this.root, 0, numNibbles * index2solver.length, nextNibbles, hashes, index2solver, solver2index);
};

ZZTree.empty = function(numValues, ixes) {
  return new ZZTree(numValues, ixes, makeBranch(0));
};

// SOLVER

function ZZContains(tree, index2solver, solver2index) {
  this.tree = tree;
  this.index2solver = index2solver;
  this.solver2index = solver2index;
}

ZZContains.prototype.probe = function(numNibbles, nextNibbles, values) {
  return this.tree.probe(numNibbles, nextNibbles, values, this.index2solver, this.solver2index);
};

function solveIn(constraints, numConstraints, numVariables, values, numNibbles, results) {
  var nextNibbles = new Array(numVariables);
  for (var i = 0; i < numVariables; i++) {
    nextNibbles[i] = -1;
  }
  var cardinality = 1;
  for (var i = 0; i < numConstraints; i++) {
    cardinality *= constraints[i].probe(numNibbles, nextNibbles, values);
    if (cardinality === 0) {
      return; // no solutions here
    }
  }
  if (cardinality === 1) {
    results.push(values.slice()); // found a solution
  } else {
    // zero out nibbles
    for (var i = 0; i < numVariables; i++) {
      values[i] = setNibble(values[i], numNibbles, 0);
    }

    // find all permutations of nextNibbles
    //console.log("Permuting", bits(nextNibbles[0]), bits(nextNibbles[1]));
    var variable = 0;
    var lastVariable = numVariables - 1;
    var value = values[variable];
    var nibble = getNibble(value, numNibbles);
    var choices = nextNibbles[variable];
    permute: while (true) {
      if ((choices & (1 << nibble)) !== 0) {
        values[variable] = setNibble(value, numNibbles, nibble);
        if (variable < lastVariable) {
          variable++;
          value = values[variable];
          nibble = getNibble(value, numNibbles);
          choices = nextNibbles[variable];
          continue permute;
        }
        //console.log("Solving for", bits(1 << getNibble(values[0], numNibbles)), bits(1 << getNibble(values[1], numNibbles)));
        solveIn(constraints, numConstraints, numVariables, values, numNibbles + 1, results);
      }

      nibble = (nibble + 1) % 16;

      if (nibble === 0) {
        while (nibble === 0) {
          if (variable === 0) break permute; // done
          values[variable] = setNibble(value, numNibbles, nibble);
          variable--;
          value = values[variable];
          nibble = (getNibble(value, numNibbles) + 1) % 16;
        }
        choices = nextNibbles[variable];
      }
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

      case LEAF:
        leaves += 1;
    }
  }
  return {
    leaves: leaves,
    branches: branches,
    children: children
  };
}

function benchZZ(users, logins, bans) {
  console.time("insert");
  //console.profile();
  var usersTree = ZZTree.empty(2, [1]).insert(users);
  var loginsTree = ZZTree.empty(2, [0, 1]).insert(logins);
  var bansTree = ZZTree.empty(1, [0]).insert(bans);
  //console.profileEnd();
  console.timeEnd("insert");
  //console.log(numNodes(usersTree), numNodes(loginsTree), numNodes(bansTree));
  //console.log(usersTree, loginsTree, bansTree);
  console.time("solve");
  //console.profile();
  var results = solve([
    new ZZContains(usersTree, [0]),
    new ZZContains(loginsTree, [0, 1]),
    new ZZContains(bansTree, [1])
  ], 2);
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

  var results = [];
  results.push(benchZZ(users, logins, bans));
  results.push(benchForward(users, logins, bans));
  results.push(benchBackward(users, logins, bans));

  return results;
}

// var x = bench(1000000);

function bits(n) {
  var s = "";
  for (var i = 31; i >= 0; i--) {
    s += (n >> i) & 1;
  }
  return s;
}