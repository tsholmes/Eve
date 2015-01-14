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

var ZZLEAF = 0;
var ZZBRANCH = 1;

function withHashes(values) {
  var hashesAndValues = [];
  for (var i = 0, len = values.length; i < len; i++) {
    var value = values[i];
    hashesAndValues[i] = hash(value);
    hashesAndValues[len + i] = value;
  }
  return hashesAndValues;
}

function ZZTree(numValues, leafWidth, branchWidth, branchDepth, ixes, root) {
  this.numValues = numValues;
  this.leafWidth = leafWidth;
  this.branchWidth = branchWidth;
  this.branchDepth = branchDepth;
  this.ixes = ixes;
  this.root = root;
}

ZZTree.prototype.isBranch = function(node) {
  return node[0] === ZZBRANCH;
};

ZZTree.prototype.getCardinality = function(node) {
  return node[1];
};

ZZTree.prototype.hasBit = function(node, value, position, bit) {
  var bits = node[2 + (this.numValues * bit) + value];
  return (bits & position) === (bit * position);
};

// leaf layout is ZZLEAF, cardinality, los, his, <= leafWidth * (hashes, values)
ZZTree.prototype.emptyLeaf = function() {
  var numValues = this.numValues;
  var leaf = [ZZLEAF, 0];
  for (var i = 0; i < numValues; i++) {
    leaf[2 + i] = -1; // lo is all 1s
  }
  for (var i = 0; i < numValues; i++) {
    leaf[2 + numValues + i] = 0; // hi is all 0s
  }
  return leaf;
};

ZZTree.prototype.appendToLeaf = function(leaf, hashesAndValues) {
  var leafEnd = leaf.length;
  for (var i = 0, len = hashesAndValues.length; i < len; i++) {
    leaf[leafEnd + i] = hashesAndValues[i];
  }
};

ZZTree.prototype.updateLeaf = function(leaf) {
  var numValues = this.numValues;
  var leafEnd = leaf.length;
  var loStart = 2;
  var hiStart = loStart + numValues;
  var leafStart = hiStart + numValues;
  var numFacts = (leafEnd - leafStart) / (2 * numValues);
  for (var factIx = 0; factIx < numFacts; factIx++) {
    for (var valueIx = 0; valueIx < numValues; valueIx++) {
      var hash = leaf[leafStart + (2 * numValues * factIx) + valueIx];
      leaf[loStart + valueIx] = leaf[loStart + valueIx] & hash;
      leaf[hiStart + valueIx] = leaf[hiStart + valueIx] | hash;
    }
  }
  leaf[1] = numFacts;
};

ZZTree.prototype.getHash = function(leaf, fact, value) {
  var numValues = this.numValues;
  return leaf[2 + (2 * numValues) + (fact * 2 * numValues) + value];
};

// branch layout is ZZBRANCH, cardinality, los, his, <= branchWidth * (pathIx, childPointer)
ZZTree.prototype.emptyBranch = function() {
  var numValues = this.numValues;
  var branch = [ZZBRANCH, 0];
  for (var i = 0; i < numValues; i++) {
    branch[2 + i] = -1; // lo is all 1s
  }
  for (var i = 0; i < numValues; i++) {
    branch[2 + numValues + i] = 0; // hi is all 0s
  }
  return branch;
};

ZZTree.prototype.appendToBranch = function(branch, pathIx, child) {
  var branchEnd = branch.length;
  branch[branchEnd] = pathIx;
  branch[branchEnd + 1] = child;
};

ZZTree.prototype.updateBranch = function(branch) {
  var numValues = this.numValues;
  var branchEnd = branch.length;
  var loStart = 2;
  var hiStart = loStart + numValues;
  var branchStart = hiStart + numValues;
  var numChildren = (branchEnd - branchStart) / 2;
  var numFacts = 0;
  for (var childIx = 0; childIx < numChildren; childIx++) {
    for (var valueIx = 0; valueIx < numValues; valueIx++) {
      var child = branch[branchStart + (2 * childIx) + 1];
      numFacts += child[1];
      branch[loStart + valueIx] = branch[loStart + valueIx] & child[loStart + valueIx];
      branch[hiStart + valueIx] = branch[hiStart + valueIx] | child[hiStart + valueIx];
    }
  }
  branch[1] = numFacts;
};

ZZTree.prototype.numChildren = function(branch) {
  var numValues = this.numValues;
  var branchEnd = branch.length;
  var loStart = 2;
  var hiStart = loStart + numValues;
  var branchStart = hiStart + numValues;
  var numChildren = (branchEnd - branchStart) / 2;
  return numChildren;
};

ZZTree.prototype.getChild = function(branch, child) {
  var numValues = this.numValues;
  return branch[2 + (2 * numValues) + (2 * child) + 1];
};

// the path interleaves bits from each of the hashes
ZZTree.prototype.pathAt = function(hashesAndValues, pathIx) {
  var branchDepth = this.branchDepth;
  var ixes = this.ixes;
  var length = ixes.length;
  var path = 0;
  var maxBitIx = length * 32;
  for (var i = 0; i < branchDepth; i++) {
    var bitIx = maxBitIx - ((pathIx * branchDepth) + i) - 1;
    var hash = hashesAndValues[ixes[bitIx % length]];
    var bit = (hash >> ((bitIx / length) | 0)) & 1;
    path = path | (bit << (branchDepth - i - 1));
  }
  return path;
};

ZZTree.prototype.bucketSort = function(inserts, pathIx) {
  var buckets = [];
  var branchWidth = this.branchWidth;
  for (var path = 0; path < branchWidth; path++) {
    buckets[path] = [];
  }
  for (var i = 0, len = inserts.length; i < len; i++) {
    var insert = inserts[i];
    var path = this.pathAt(insert, pathIx);
    buckets[path].push(insert);
  }
  return buckets;
};

ZZTree.prototype.buildNodeFrom = function(inserts, pathIx) {
  var numInserts = inserts.length;
  if (numInserts <= this.leafWidth) {
    var leaf = this.emptyLeaf();
    for (var i = 0; i < numInserts; i++) {
      this.appendToLeaf(leaf, inserts[i]);
    }
    this.updateLeaf(leaf);
    return leaf;
  } else {
    var branch = this.emptyBranch();
    var buckets = this.bucketSort(inserts, pathIx);
    var branchWidth = this.branchWidth;
    for (var path = 0; path < branchWidth; path++) {
      var bucket = buckets[path];
      if (bucket.length > 0) {
        this.appendToBranch(branch, path, this.buildNodeFrom(bucket, pathIx + 1));
      }
    }
    this.updateBranch(branch);
    return branch;
  }
};

ZZTree.prototype.insertToNode = function(node, inserts, pathIx) {
  if (node[0] === ZZBRANCH) {
    // TODO handle this case
    // bucket sort
    // for each bucket
    //   if exists in branch, insertToNode and append
    //   if doesn't exist, buildNodeFrom and append
    assert(false);
  } else {
    // TODO if pathIx is at max just make a big leaf
    // TODO zzleaf$explodeInto(leaf, inserts);
    return this.buildNodeFrom(inserts, pathIx);
  }
};

ZZTree.prototype.insert = function(facts) {
  var inserts = [];
  for (var i = 0, len = facts.length; i < len; i++) {
    inserts[i] = withHashes(facts[i]);
  }
  var root = this.insertToNode(this.root, inserts, 0);
  return new ZZTree(this.numValues, this.leafWidth, this.branchWidth, this.branchDepth, this.ixes, root);
};

ZZTree.empty = function(numValues, leafWidth, branchDepth, ixes) {
  var branchWidth = Math.pow(2, branchDepth);
  var tree = new ZZTree(numValues, leafWidth, branchWidth, branchDepth, ixes, null);
  tree.root = tree.emptyLeaf();
  return tree;
};

// SOLVER

var counts = new Int32Array(1000);

// TODO grab tree from state
function ZZContains(tree, ixes) {
  this.tree = tree;
  this.ixes = ixes;
}

ZZContains.prototype.init = function(solver, volume, myIx) {
  var tree = this.tree;
  var root = tree.root;
  solver.setCardinality(volume, myIx, tree.getCardinality(root));
  solver.setNodes(volume, myIx, [root, -1]);
};

// TODO bitmap breaks if we have >32 facts in a leaf - may have to allocate instead
ZZContains.prototype.split = function(solver, loVolume, hiVolume, myIx, variable, position) {
  var tree = this.tree;
  var oldNodes = solver.getNodes(loVolume, myIx);
  var queuedNodes = oldNodes.slice();
  var loNodes = [];
  var hiNodes = [];
  var loCardinality = 0;
  var hiCardinality = 0;

  var ix = this.ixes[variable];
  if (ix === null) return; // no change here

  counts[Math.floor(Math.log(oldNodes.length))] += 1;

  while (queuedNodes.length > 0) {
    var bitmap = queuedNodes.pop();
    var node = queuedNodes.pop();
    var hasLo = tree.hasBit(node, ix, position, 0);
    var hasHi = tree.hasBit(node, ix, position, 1);
    if (hasLo && !hasHi) {
      // only matches lo
      loNodes.push(node);
      loNodes.push(bitmap);
      loCardinality += tree.getCardinality(node);
    } else if (!hasLo && hasHi) {
      // only matches hi
      hiNodes.push(node);
      hiNodes.push(bitmap);
      hiCardinality += tree.getCardinality(node);
    } else if (hasLo && hasHi) {
      // matches hi and lo, have to break it up
      if (tree.isBranch(node)) {
        // is a branch, check all children
        var numChildren = tree.numChildren(node);
        for (var child = 0; child < numChildren; child++) {
          queuedNodes.push(tree.getChild(node, child));
          queuedNodes.push(-1); // all children match so far
        }
      } else {
        // is a leaf, check number of matches
        var numFacts = tree.getCardinality(node);
        var loBitmap = 0;
        var hiBitmap = 0;
        for (var fact = 0; fact < numFacts; fact++) {
          if ((bitmap & (1 << fact)) > 0) {
            var hash = tree.getHash(node, fact, ix);
            if ((hash & position) === 0) {
              // fact matches lo
              loCardinality += 1;
              loBitmap = loBitmap | (1 << fact);
            } else {
              // fact matches hi
              hiCardinality += 1;
              hiBitmap = hiBitmap | (1 << fact);
            }
          }
        }
        if (loBitmap !== 0) {
          loNodes.push(node);
          loNodes.push(loBitmap);
        }
        if (hiBitmap !== 0) {
          hiNodes.push(node);
          hiNodes.push(hiBitmap);
        }
      }
    }
  }

  solver.setCardinality(loVolume, myIx, loCardinality);
  solver.setNodes(loVolume, myIx, loNodes);
  solver.setCardinality(hiVolume, myIx, hiCardinality);
  solver.setNodes(hiVolume, myIx, hiNodes);
};


function Solver(numVariables, constraints) {
  this.numVariables = numVariables;
  this.constraints = constraints;
}

// volume layout is lastSplit, numVariables * lo, numVariables * hi, numConstraints * nodes, numConstraints * cardinality
Solver.prototype.wholeVolume = function() {
  var volume = [0];
  var numVariables = this.numVariables;
  for (var i = 0; i < numVariables; i++) {
    volume.push(0); // lo is all 0s
  }
  for (var i = 0; i < numVariables; i++) {
    volume.push(-1); // hi is all 1s
  }
  var constraints = this.constraints;
  for (var i = 0, len = constraints.length; i < len; i++) {
    constraints[i].init(this, volume, i);
  }
  return volume;
};

Solver.prototype.getLo = function(volume, variable) {
  return volume[1 + variable];
};

Solver.prototype.getHi = function(volume, variable) {
  return volume[1 + this.numVariables + variable];
};

Solver.prototype.setBit = function(volume, variable, position, bit) {
  if (bit === 0) {
    // knock the hi bit down
    var ix = 1 + this.numVariables + variable;
    volume[ix] = volume[ix] & ~position;
  } else {
    // knock the lo bit up
    var ix = 1 + variable;
    volume[ix] = volume[ix] | position;
  }
};

Solver.prototype.getNodes = function(volume, constraint) {
  return volume[1 + this.numVariables + this.numVariables + constraint];
};

Solver.prototype.setNodes = function(volume, constraint, nodes) {
  volume[1 + this.numVariables + this.numVariables + constraint] = nodes;
};

Solver.prototype.getCardinality = function(volume) {
  var numConstraints = this.constraints.length;
  var start = 1 + this.numVariables + this.numVariables + numConstraints;
  var cardinality = 1;
  for (var i = 0; i < numConstraints; i++) {
    cardinality *= volume[start + i];
  }
  return cardinality;
};

Solver.prototype.setCardinality = function(volume, constraint, cardinality) {
  var numConstraints = this.constraints.length;
  var start = 1 + this.numVariables + this.numVariables + numConstraints;
  volume[start + constraint] = cardinality;
};

Solver.prototype.getLastSplit = function(volume) {
  return volume[0];
};

Solver.prototype.setLastSplit = function(volume, lastSplit) {
  volume[0] = lastSplit;
};

Solver.prototype.split = function(loVolume, hiVolume, variable, position) {
  var constraints = this.constraints;
  this.setBit(loVolume, variable, position, 0);
  this.setBit(hiVolume, variable, position, 1);
  for (var i = 0, len = constraints.length; i < len; i++) {
    constraints[i].split(this, loVolume, hiVolume, i, variable, position);
  }
};

Solver.prototype.zzenqueue = function(queuedVolumes, newVolumes, volume) {
  var cardinality = this.getCardinality(volume);
  if (cardinality > 1) {
    // lots to do, keep going
    queuedVolumes.push(volume);
  } else if (cardinality > 0) {
    // nearly solved, pass it on
    newVolumes.push(volume);
  }
  // otherwise no results, throw it away
};

Solver.prototype.zzjoin = function(oldVolumes, variables) {
  var queuedVolumes = oldVolumes.slice();
  var newVolumes = [];

  nextVolume: while (queuedVolumes.length > 0) {
    var volume = queuedVolumes.pop();

    // find an unknown bit
    var numVariables = variables.length;
    var lastSplit = this.getLastSplit(volume);
    var nextSplit = lastSplit;
    var splitVariable, splitBit;
    findBit: while (true) {
      nextSplit = (nextSplit + 1) % numVariables;

      var splitVariable = variables[nextSplit];
      var lo = this.getLo(volume, splitVariable);
      var hi = this.getHi(volume, splitVariable);
      var unknownBits = lo ^ hi;
      splitBit = unknownBits & -unknownBits; // least-significant unknown bit

      if (splitBit !== 0) break findBit; // use this bit

      if (nextSplit === lastSplit) {
        // no bits left unset, pass it on
        newVolumes.push(volume);
        continue nextVolume;
      }
    }

    // split on the unknown bit
    this.setLastSplit(volume, nextSplit);
    var loVolume = volume.slice();
    var hiVolume = volume.slice();
    this.split(loVolume, hiVolume, splitVariable, splitBit);
    this.zzenqueue(queuedVolumes, newVolumes, loVolume);
    this.zzenqueue(queuedVolumes, newVolumes, hiVolume);
  }

  return newVolumes;
};

Solver.prototype.solve = function(variables) {
  var volumes = [this.wholeVolume()];
  return this.zzjoin(volumes, variables);
};

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
  var nodes = [tree.root];
  while (nodes.length > 0) {
    var node = nodes.pop();
    if (tree.isBranch(node)) {
      branches += 1;
      var numChildren = tree.numChildren(node);
      for (var i = 0; i < numChildren; i++) {
        nodes.push(tree.getChild(node, i));
      }
    } else {
      leaves += 1;
    }
  }
  return {
    leaves: leaves,
    branches: branches
  };
}

function bench(numUsers, numLogins, numBans, leafWidth, branchDepth) {
  leafWidth = leafWidth || 32;
  branchDepth = branchDepth || 4;
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
  var usersTree = ZZTree.empty(2, leafWidth, branchDepth, [1]).insert(users);
  var loginsTree = ZZTree.empty(2, leafWidth, branchDepth, [0, 1]).insert(logins);
  var bansTree = ZZTree.empty(1, leafWidth, branchDepth, [0]).insert(bans);
  console.timeEnd("insert");
  console.log(numNodes(usersTree), numNodes(loginsTree), numNodes(bansTree));
  console.log(usersTree, loginsTree, bansTree);
  var solver = new Solver(3, [
    new ZZContains(usersTree, [0, 1, null]),
    new ZZContains(loginsTree, [null, 0, 1]),
    new ZZContains(bansTree, [null, null, 0])
  ]);
  console.time("solve");
  console.profile();
  var solverResults = solver.solve([1, 2]);
  console.profileEnd();
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