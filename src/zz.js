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

// TODO try varying depth dynamically to maintain branch occupancy

function pathEqual(a, b) {
  var len = a.length;
  for (var i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
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

ZZLeaf.fromFact = function(factLength, branchDepth, fact) {
  assert(fact.length === factLength);
  var hashes = new Int32Array(fact.length);
  for (var i = 0, len = fact.length; i < len; i++) {
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
    var branch = branches.pop();
    for (var i = 0; i < this.branchWidth; i++) {
      var child = branch[i];
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
  var factLength = this.factLength;
  var branchDepth = this.branchDepth;
  for (var i = 0, len = facts.length; i < len; i++) {
    leaves[i] = ZZLeaf.fromFact(factLength, branchDepth, facts[i]);
  }
  var root = this.root.slice();
  this.bulkInsertToBranch(root, 0, leaves);
  return new ZZTree(this.factLength, this.branchDepth, this.branchWidth, root);
};

ZZTree.prototype.bulkInsertToBranch = function(branch, pathIx, leaves) {
  // assert(pathIx < leaves[0].path.length); // TODO handle collisions
  var buckets = [];
  for (var branchIx = 0; branchIx < this.branchWidth; branchIx++) {
    buckets[branchIx] = [];
  }
  for (var i = 0, len = leaves.length; i < len; i++) {
    var leaf = leaves[i];
    var branchIx = leaf.path(this.branchDepth, pathIx);
    buckets[branchIx].push(leaf);
  }
  for (var branchIx = 0; branchIx < this.branchWidth; branchIx++) {
    var bucket = buckets[branchIx];
    if (bucket.length > 0) {
      var child = branch[branchIx];
      if (child === undefined) {
        if (bucket.length === 1) {
          branch[branchIx] = bucket[0];
        } else {
          var childBranch = new Array(this.branchWidth);
          branch[branchIx] = childBranch;
          this.bulkInsertToBranch(childBranch, pathIx + 1, bucket);
        }
      } else if (child.constructor === ZZLeaf) {
        var childBranch = new Array(this.branchWidth);
        // assert(pathIx+1 < leaves[0].path.length); // TODO handle collisions
        branch[branchIx] = childBranch;
        bucket.push(child);
        this.bulkInsertToBranch(childBranch, pathIx + 1, bucket);
      } else {
        var childBranch = child.slice();
        branch[branchIx] = childBranch;
        this.bulkInsertToBranch(childBranch, pathIx + 1, bucket);
      }
    }
  }
};

//   remove: function(fact) {
//     var path = makePath(this.branchDepth, fact);
//     var pathIx = 0;
//     var root = this.root.slice();
//     var branch = root;
//     var branches = [];

//     down: while (true) {
//       var branchIx = path[pathIx];
//       pathIx++;
//       var child = branch[branchIx];
//       if (child === undefined) {
//         return new ZZTree(this.branchDepth, this.branchWidth, root); // nothing to clean up
//       } else if (child.constructor === ZZLeaf) {
//         var facts = child.facts.slice();
//         splice: for (var i = 0; i < facts.length; i++) {
//           if (arrayEqual(facts[i], fact)) {
//             facts.splice(i, 1);
//             break splice;
//           }
//         }
//         if (facts.length > 0) {
//           branch[branchIx] = new ZZLeaf(child.path, facts);
//           return new ZZTree(this.branchDepth, this.branchWidth, root); // nothing to clean up
//         } else {
//           break down; // go clean up
//         }
//       } else {
//         branches.push(branch);
//         var childBranch = child.slice();
//         branch[branchIx] = childBranch;
//         branch = childBranch;
//         continue down;
//       }
//     }

//     up: while (true) {
//       pathIx--;
//       var branchIx = path[pathIx]
//       delete branch[branchIx];
//       for (var i = 0; i < this.branchWidth; i++) {
//         if (branch[i] !== undefined) {
//           break up; // done cleaning up
//         }
//       }
//       branch = branches.pop();
//     }

//     return new ZZTree(this.branchDepth, this.branchWidth, root);
//   }
// }

// TODO zztree.validate

ZZTree.empty = function(factLength, branchDepth) {
  var branchWidth = Math.pow(2, branchDepth);
  return new ZZTree(factLength, branchDepth, branchWidth, new Array(branchWidth));
};

// SOLVER

// split for hash -> value?

// instead of los/his - bits and ixes
// could also split by picking random bit?

// use recursion for tracking stack
// pass solver and solver state to constraint to split
// constraint can modify state and call solve multiple times

var FAILED = -1;
var UNCHANGED = 0;
var CHANGED = 1;
// TODO use bitflag to indicate which vars changed

function inBounds(lo, value, hi) {
  return ((lo & ~value) | (~hi & value)) === 0;
}

function ZZContains(tree, bindings) {
  this.tree = tree;
  this.bindings = bindings;
}

function ZZContainsState(branch, pathIx) {
  this.branch = branch;
  this.pathIx = pathIx;
  this.children = 0;
}

ZZContains.prototype.init = function() {
  return new ZZContainsState(this.tree.root, 0);
};

ZZContains.prototype.getBounds = function(pathIx, los, his) {
  var bindings = this.bindings;
  var depth = this.tree.branchDepth;
  var length = this.bindings.length;
  var lo = 0;
  var hi = 0;
  for (var i = 0; i < depth; i++) {
    var bitIx = (pathIx * depth) + i;
    var bindingIx = bindings[bitIx % length];
    var hashIx = ((bitIx / length) | 0);
    var lohash = los[bindingIx];
    var lobit = (lohash >> hashIx) & 1;
    var lo = lo | (lobit << i);
    var hihash = his[bindingIx];
    var hibit = (hihash >> hashIx) & 1;
    var hi = hi | (hibit << i);
  }
  return [lo, hi];
};

ZZContains.prototype.setBounds = function(pathIx, los, his, setlo, sethi) {
  var bindings = this.bindings;
  var depth = this.tree.branchDepth;
  var length = this.bindings.length;
  var changed = false;
  for (var i = 0; i < depth; i++) {
    var bitIx = (pathIx * depth) + i;
    var bindingIx = bindings[bitIx % length];
    var hashIx = ((bitIx / length) | 0);

    var lobit = (setlo >> i) & 1;
    var oldlo = los[bindingIx];
    var newlo = oldlo | (lobit << hashIx);
    changed = changed || (oldlo !== newlo);
    los[bindingIx] = newlo;

    var hibit = (sethi >> i) & 1;
    var oldhi = his[bindingIx];
    var newhi = oldhi & ~((1 - hibit) << hashIx);
    changed = changed || (oldhi !== newhi);
    his[bindingIx] = newhi;
  }
  return changed;
};

ZZContains.prototype.setValue = function(leaf, los, his, values, changed) {
  var bindings = this.bindings;
  var hashes = leaf.hashes;
  var fact = leaf.fact;
  var changed = changed;
  for (var i = 0, len = hashes.length; i < len; i++) {
    var bindingIx = bindings[i];
    var hash = hashes[i];
    var lo = los[bindingIx];
    var hi = his[bindingIx];
    if (!inBounds(lo, hash, hi)) return FAILED;
    var changed = changed || (lo !== hash) || (hi !== hash);
    los[bindingIx] = hash;
    his[bindingIx] = hash;
    values[bindingIx] = fact[i];
  }
  return changed ? CHANGED : UNCHANGED;
};

// TODO return changed bitmask
ZZContains.prototype.propagate = function(states, splits, myIx, los, his, values) {
  var width = this.tree.branchWidth;
  var state = states[myIx];
  var branch = state.branch;
  var pathIx = state.pathIx;
  var changed = false;
  propagate: while (true) {
    if (branch.constructor === ZZLeaf) {
      // fix the value
      states[myIx] = new ZZContainsState(branch, pathIx);
      splits[myIx] = [];
      return this.setValue(branch, los, his, values, changed);
    } else {

      // figure out which children are in bounds
      var bounds = this.getBounds(pathIx, los, his);
      var lo = bounds[0];
      var hi = bounds[1];
      var newlo = -1; // all 1s
      var newhi = 0; // all 0s
      var children = [];
      for (var i = 0; i < width; i++) {
        // if i has 1s where lo has 1s and 0s where hi has 0s
        // and there is a branch for i
        if (inBounds(lo, i, hi) &&
          (branch[i] !== undefined)) {
          newlo = newlo & i; // drop lo to 0 wherever i has a 0
          newhi = newhi | i; // raise hi to 1 wherever i has a 1
          children.push(i);
        }
      }

      if (children.length === 0) {
        // no matching children
        return FAILED;
      } else if (children.length === 1) {
        // only one matching child
        changed = changed || this.setBounds(pathIx, los, his, newlo, newhi);
        branch = branch[newlo];
        pathIx++;
        continue propagate;
      } else {
        changed = changed || this.setBounds(pathIx, los, his, newlo, newhi);
        states[myIx] = new ZZContainsState(branch, pathIx);
        splits[myIx] = children;
        return changed ? CHANGED : UNCHANGED;
      }
    }
  }
};

ZZContains.prototype.split = function(states, splits, myIx, los, his, values, children) {
  var state = states[myIx];
  var branch = state.branch;
  var pathIx = state.pathIx;
  var child = children.pop();
  this.setBounds(pathIx, los, his, child, child);
  branch = branch[child];
  pathIx++;
  states[myIx] = new ZZContainsState(branch, pathIx);
};

function solveMore(numVars, constraints, states, splits, los, his, values, results, lastSplit) {

  // propagate until stable
  var numConstraints = constraints.length;
  var lastChanged = (lastSplit - 1 + numConstraints) % numConstraints;
  var currentConstraint = lastSplit;
  propagate: while (true) {
    var result = constraints[currentConstraint].propagate(states, splits, currentConstraint, los, his, values);
    if (result === FAILED) return;
    if (result === CHANGED) lastChanged = currentConstraint;
    currentConstraint = (currentConstraint + 1) % numConstraints;
    if (lastChanged === currentConstraint) break propagate;
  }


  // look for something to split
  var currentConstraint = (lastSplit + 1) % numConstraints;
  split: while (true) {
      var split = splits[currentConstraint];
      if (split.length > 0) {
        var constraint = constraints[currentConstraint];
        splits[currentConstraint] = [];
        while (split.length > 0) {
          var newStates = states.slice();
          var newSplits = splits.slice();
          var newLos = los.slice();
          var newHis = his.slice();
          var newValues = values.slice();
          constraint.split(newStates, newSplits, currentConstraint, newLos, newHis, newValues, split);
          solveMore(numVars, constraints, newStates, newSplits, newLos, newHis, newValues, results, currentConstraint);
        }
        return;
      }
      if (currentConstraint === lastSplit) break split; // TODO this just assumes that we're done now
      currentConstraint = (currentConstraint + 1) % numConstraints;
    }
    // if we reach here, then all bits are known
    // TODO how do we guarantee that all values have been set?
  results.push(values);
}

function solve(numVars, constraints) {
  var states = [];
  var splits = [];
  var los = [];
  var his = [];
  var values = [];
  for (var i = 0, len = constraints.length; i < len; i++) {
    states[i] = constraints[i].init();
    splits[i] = [];
  }
  for (var i = 0; i < numVars; i++) {
    los[i] = 0;
    his[i] = -1;
    values[i] = undefined;
  }

  var results = [];
  solveMore(numVars, constraints, states, splits, los, his, values, results, 0);
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

console.time("solve");
var s = solve(3, [new ZZContains(a, [0, 1]), new ZZContains(b, [1, 2])]);
console.timeEnd("solve");

function bench(n) {
  var facts = [];
  for (var i = 0; i < n; i++) {
    facts.push([i + "zomg", i + "foo" + i, i]);
  }
  var facts2 = [];
  for (var i = 0; i < n; i++) {
    facts2.push([i + "bar", i + "quux" + i, i]);
  }
  console.time("insert");
  console.profile();
  var t = ZZTree.empty(3, 4).bulkInsert(facts).bulkInsert(facts2);
  console.profileEnd();
  console.timeEnd("insert");
  console.time("obj");
  var x = {};
  for (var i = 0; i < n; i++) {
    x[facts[i]] = true;
  }
  for (var i = 0; i < n; i++) {
    x[facts2[i]] = true;
  }
  console.timeEnd("obj");
  return t.constructor;
}

// var x = bench(1000000);

function bits(n) {
  var s = "";
  for (var i = 31; i >= 0; i--) {
    s += (n >> i) & 1;
  }
  return s;
}