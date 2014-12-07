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

var minHash = Math.pow(2, 31) | 0;
var maxHash = (Math.pow(2, 31) - 1) | 0;

function minInto(runningMin, value) {
  for (var j = 0, len = runningMin.length; j < len; j++) {
    runningMin[j] = Math.min(runningMin[j], value[j]);
  }
}

function maxInto(runningMax, value) {
  for (var j = 0, len = runningMax.length; j < len; j++) {
    runningMax[j] = Math.max(runningMax[j], value[j]);
  }
}

function ZZTree(factLength, branchDepth, branchWidth, root) {
  assert(branchDepth <= 8);
  this.factLength = factLength;
  this.branchDepth = branchDepth;
  this.branchWidth = branchWidth;
  this.root = root;
}

function ZZLeaf(fact, hashes) {
  this.fact = fact;
  this.hashes = hashes;
}

function ZZBranch(los, his, children) {
  this.los = los;
  this.his = his;
  this.children = children;
}

function nodeLos(node) {
  return (node.constructor === ZZLeaf) ? node.hashes : node.los;
}

function nodeHis(node) {
  return (node.constructor === ZZLeaf) ? node.hashes : node.his;
}

ZZBranch.fromChildren = function(factLength, branchWidth, children) {
  var los = new Int32Array(factLength);
  var his = new Int32Array(factLength);
  for (var i = 0; i < factLength; i++) {
    los[i] = maxHash;
    his[i] = minHash;
  }
  for (var i = 0; i < branchWidth; i++) {
    var child = children[i];
    var childLos, childHis;
    if (child !== undefined) {
      minInto(los, nodeLos(child));
      maxInto(his, nodeHis(child));
    }
  }
  return new ZZBranch(los, his, children);
};

ZZLeaf.fromFact = function(factLength, branchDepth, fact) {
  assert(fact.length === factLength);
  var hashes = new Int32Array(factLength);
  for (var i = 0; i < factLength; i++) {
    hashes[i] = hash(fact[i]);
  }
  return new ZZLeaf(fact, hashes);
};

ZZLeaf.prototype.path = function(depth, pathIx) {
  var hashes = this.hashes;
  var length = hashes.length;
  var path = 0;
  for (var i = 0; i < depth; i++) {
    var bitIx = (pathIx * depth) + i;
    var hash = hashes[bitIx % length];
    var bit = (hash >> ((bitIx / length) | 0)) & 1;
    path = path | (bit << i);
  }
  return path;
};

ZZTree.prototype.facts = function() {
  var facts = [];
  var branches = [this.root];
  while (branches.length > 0) {
    var children = branches.pop().children;
    for (var i = 0; i < this.branchWidth; i++) {
      var child = children[i];
      if (child === undefined) {
        // pass
      } else if (child.constructor === ZZLeaf) {
        facts.push(child.fact);
      } else {
        branches.push(child);
      }
    }
  }
  return facts;
};

ZZTree.prototype.bulkInsert = function(facts) {
  var leaves = [];
  for (var i = 0, len = facts.length; i < len; i++) {
    leaves[i] = ZZLeaf.fromFact(this.factLength, this.branchDepth, facts[i]);
  }
  var children = this.root.children.slice();
  this.bulkInsertToChildren(children, 0, leaves);
  var root = ZZBranch.fromChildren(this.factLength, this.branchWidth, children);
  return new ZZTree(this.factLength, this.branchDepth, this.branchWidth, root);
};

// TODO handle collisions
ZZTree.prototype.bulkInsertToChildren = function(children, pathIx, leaves) {
  // bucket sort the leaves
  var buckets = [];
  for (var branchIx = 0; branchIx < this.branchWidth; branchIx++) {
    buckets[branchIx] = [];
  }
  for (var i = 0, len = leaves.length; i < len; i++) {
    var leaf = leaves[i];
    var branchIx = leaf.path(this.branchDepth, pathIx);
    buckets[branchIx].push(leaf);
  }

  // insert buckets
  for (var branchIx = 0; branchIx < this.branchWidth; branchIx++) {
    var bucket = buckets[branchIx];
    if (bucket.length > 0) {
      var child = children[branchIx];
      if (child === undefined) {
        // make a child
        if (bucket.length === 1) {
          children[branchIx] = bucket[0];
        } else {
          var grandchildren = new Array(this.branchWidth);
          this.bulkInsertToChildren(grandchildren, pathIx + 1, bucket);
          children[branchIx] = ZZBranch.fromChildren(this.factLength, this.branchWidth, grandchildren);
        }
      } else if (child.constructor === ZZLeaf) {
        // make a branch and carry the leaf down
        var grandchildren = new Array(this.branchWidth);
        bucket.push(child);
        this.bulkInsertToChildren(grandchildren, pathIx + 1, bucket);
        children[branchIx] = ZZBranch.fromChildren(this.factLength, this.branchWidth, grandchildren);
      } else {
        // insert into branch
        var grandchildren = child.children.slice();
        this.bulkInsertToChildren(grandchildren, pathIx + 1, bucket);
        children[branchIx] = ZZBranch.fromChildren(this.factLength, this.branchWidth, grandchildren);
      }
    }
  }
};

ZZTree.empty = function(factLength, branchDepth) {
  var branchWidth = Math.pow(2, branchDepth);
  var root = ZZBranch.fromChildren(this.factLength, this.branchWidth, new Array(branchWidth));
  return new ZZTree(factLength, branchDepth, branchWidth, root);
};

// SOLVER

var FAILED = -1;
var UNCHANGED = 0;
var CHANGED = 1;
// TODO use bitflag to indicate which vars changed

function ZZContains(tree, bindings) {
  this.tree = tree;
  this.bindings = bindings;
}

ZZContains.prototype.init = function() {
  return [this.tree.root];
};

var INSIDE = 0;
var OVERLAPPING = 1;
var OUTSIDE = 2;

function compareBounds(innerLos, innerHis, outerLos, outerHis) {
  var inside = true;
  var outside = true;
  for (var i = 0, len = innerLos.length; i < len; i++) {
    outside &= (innerLos[i] > outerHis[i]) | (innerHis[i] < outerLos[i]);
    inside &= (innerLos[i] >= outerLos[i]) & (innerHis[i] <= outerHis[i]);
  }
  return inside ? INSIDE : (outside ? OUTSIDE : OVERLAPPING);
}

ZZContains.prototype.propagate = function(states, myIx, los, his, values) {
  // pull out bounds
  var bindings = this.bindings;
  var oldLos = new Int32Array(bindings.length);
  var oldHis = new Int32Array(bindings.length);
  for (var i = 0, len = bindings.length; i < len; i++) {
    var bindingIx = bindings[i];
    oldLos[i] = los[bindingIx];
    oldHis[i] = his[bindingIx];
  }

  // find nodes contain in bounds
  var oldNodes = states[myIx].slice();
  var newNodes = [];
  while (oldNodes.length > 0) {
    var node = oldNodes.pop();
    var comparison = compareBounds(nodeLos(node), nodeHis(node), oldLos, oldHis);
    if (comparison === INSIDE) {
      // totally in bounds - keep branch
      newNodes.push(node);
    } else if ((comparison === OVERLAPPING) && (node.constructor === ZZBranch)) {
      // partially in bounds - explore children
      var children = node.children;
      for (var i = 0, len = children.length; i < len; i++) {
        var child = children[i];
        if (child !== undefined) oldNodes.push(child);
      }
    } else {
      // totally out of bounds, discard branch
    }
  }
  states[myIx] = newNodes;

  // figure out new bounds
  var newLos = oldHis;
  var newHis = oldLos;
  for (var i = 0, len = newNodes.length; i < len; i++) {
    var node = newNodes[i];
    minInto(newLos, nodeLos(node));
    maxInto(newHis, nodeHis(node));
  }

  // update bounds
  if (newNodes.length === 0) return FAILED;
  var changed = false;
  for (var i = 0, len = bindings.length; i < len; i++) {
    var bindingIx = bindings[i];
    var oldLo = los[bindingIx];
    var oldHi = his[bindingIx];
    var newLo = newLos[i];
    var newHi = newHis[i];
    // TODO if (newLo === newHi) set value / handle collisions
    // TODO return changed bitmask for watches
    changed = changed || (oldLo !== newLo) || (oldHi !== newHi);
    los[bindingIx] = newLo;
    his[bindingIx] = newHi;
  }
  return changed ? CHANGED : UNCHANGED;
};

function solveMore(numVars, constraints, states, los, his, values, results, lastSplit) {

  // propagate until stable
  var numConstraints = constraints.length;
  var lastChanged = 0;
  var currentConstraint = 0;
  propagate: while (true) {
    var result = constraints[currentConstraint].propagate(states, currentConstraint, los, his, values);
    if (result === FAILED) return;
    if (result === CHANGED) lastChanged = currentConstraint;
    currentConstraint = (currentConstraint + 1) % numConstraints;
    if (lastChanged === currentConstraint) break propagate;
  }

  // look for something to split
  var currentVar = (lastSplit + 1) % numVars;
  split: while (true) {
      var lo = los[currentVar];
      var hi = his[currentVar];
      if (lo !== hi) {
        var mid = (lo + (hi - lo) / 2) | 0;
        var splitHis = new Int32Array(his);
        splitHis[currentVar] = mid;
        solveMore(numVars, constraints, states.slice(), new Int32Array(los), splitHis, values.slice(), results, currentVar);
        los[currentVar] = mid + 1;
        solveMore(numVars, constraints, states, los, his, values, results, currentVar);
        return;
      }
      if (currentVar === lastSplit) break split; // TODO this just assumes that we're done now
      currentVar = (currentVar + 1) % numVars;
    }
    // if we reach here, then all bits are known
    // TODO how do we guarantee that all values have been set?
  results.push([los, his]); // TODO results.push(values);
}

function solve(numVars, constraints) {
  var states = [];
  var los = new Int32Array(numVars);
  var his = new Int32Array(numVars);
  var values = [];
  for (var i = 0, len = constraints.length; i < len; i++) {
    states[i] = constraints[i].init();
  }
  for (var i = 0; i < numVars; i++) {
    los[i] = minHash;
    his[i] = maxHash;
    values[i] = undefined;
  }

  var results = [];
  solveMore(numVars, constraints, states, los, his, values, results, 0);
  return results;
}

// STUFF

var a = ZZTree.empty(2, 4).bulkInsert([
  ["foo", "bar"],
  ["bad", "quux"],
]);
var b = ZZTree.empty(2, 4).bulkInsert([
  ["bar", "quux"],
  ["bar", "hullabaloo"],
  ["baz", "panic"],
]);

// console.time("solve");
// var s = solve(3, [new ZZContains(a, [0, 1]), new ZZContains(b, [1, 2])]);
// console.timeEnd("solve");

function bench(n) {
  var facts = [];
  for (var i = 0; i < n; i++) {
    facts.push([i + "zomg", i + "foo" + i, i]);
  }
  var facts2 = [];
  for (var i = 0; i < n; i++) {
    facts2.push([i, i + "bar", i + "quux" + i]);
  }

  console.time("insert");
  var a = ZZTree.empty(3, 4).bulkInsert(facts);
  var b = ZZTree.empty(3, 4).bulkInsert(facts2);
  console.timeEnd("insert");
  console.time("solve");
  console.profile();
  var s = solve(5, [new ZZContains(a, [0, 1, 2]), new ZZContains(b, [2, 3, 4])]);
  console.profileEnd();
  console.timeEnd("solve");

  console.time("insert obj");
  var index = {};
  for (var i = 0; i < n; i++) {
    var fact = facts[i];
    index[fact[2]] = fact;
  }
  var index2 = {};
  for (var i = 0; i < n; i++) {
    var fact = facts2[i];
    index2[fact[2]] = fact;
  }
  console.timeEnd("insert obj");
  console.time("solve obj");
  var s2 = [];
  for (var i = 0; i < n; i++) {
    var fact = facts[i];
    var fact2 = index[fact[2]];
    s2.push([fact[0], fact[1], fact[2], fact2[1], fact2[2]]);
  }
  console.timeEnd("solve obj");
  // console.time("solve array");
  // var s3 = [];
  // for (var i = 0; i < n; i++) {
  //   for (var j = 0; j < n; j++) {
  //     var fact = facts[i];
  //     var fact2 = facts2[i];
  //     if (fact[2] === fact2[0]) s3.push([fact[0], fact[1], fact[2], fact2[1], fact2[2]]);
  //   }
  // }
  // console.timeEnd("solve array");

  return s.slice(0, 10);
}

// var x = bench(1000000);

function bits(n) {
  var s = "";
  for (var i = 31; i >= 0; i--) {
    s += (n >> i) & 1;
  }
  return s;
}