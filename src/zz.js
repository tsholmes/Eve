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
  var root = ZZBranch.fromChildren(factLength, branchWidth, new Array(branchWidth));
  return new ZZTree(factLength, branchDepth, branchWidth, root);
};

// SOLVER
// volume layout is los, his, states

function ZZContains(tree, hashIxes, valueIxes) {
  this.tree = tree;
  this.hashIxes = hashIxes;
  this.valueIxes = valueIxes;
}

ZZContains.prototype.init = function() {
  return [this.tree.root];
};

function write(fromArray, toArray, fromIx, toIx, len) {
  for (var i = 0; i < len; i++) {
    toArray[toIx + i] = fromArray[fromIx + i];
  }
}

function overwrite(volumes, volumeStart, ixes, los, his, state, numVars, myIx) {
  for (var i = 0, len = ixes.length; i < len; i++) {
    var ix = ixes[i];
    var loIx = volumeStart + ix;
    volumes[loIx] = Math.max(volumes[loIx], los[i]);
    var hiIx = volumeStart + numVars + ix;
    volumes[hiIx] = Math.min(volumes[hiIx], his[i]);
  }
  volumes[volumeStart + numVars + numVars + myIx] = state;
}

function intersects(volumes, volumeStart, ixes, los, his, numVars) {
  var outOfBounds = false;
  for (var i = 0, len = ixes.length; i < len; i++) {
    var ix = ixes[i];
    outOfBounds = outOfBounds ||
      (his[i] < volumes[volumeStart + ix]) ||
      (los[i] > volumes[volumeStart + numVars + ix]);
  }
  return !outOfBounds;
}

function isStable(volumes, volumeStart, numVars, numConstraints) {
  var isStable = true;
  for (var i = 0; i < numConstraints; i++) {
    isStable = isStable && (volumes[volumeStart + numVars + numVars + i] === null);
  }
  return isStable;
}

ZZContains.prototype.init = function() {
  return this.tree.root;
};

ZZContains.prototype.propagate = function(inVolumes, outVolumes, stableVolumes, inVolumesEnd, numVars, numConstraints, myIx) {
  var volumeLength = numVars + numVars + numConstraints; // los, his, states
  var stateOffset = numVars + numVars + myIx;
  var outVolumesEnd = 0;
  var stableVolumesEnd = stableVolumes.length;
  var hashIxes = this.hashIxes;
  for (var inVolumeStart = 0; inVolumeStart < inVolumesEnd; inVolumeStart += volumeLength) {
    var node = inVolumes[inVolumeStart + stateOffset];
    if (node === null) {
      // nothing left to do
      write(inVolumes, outVolumes, inVolumeStart, outVolumesEnd, volumeLength);
      outVolumesEnd += volumeLength;
    } else if (node.constructor === ZZLeaf) {
      // check if stable
      inVolumes[inVolumeStart + stateOffset] = null;
      if (isStable(inVolumes, inVolumeStart, numVars, numConstraints)) {
        write(inVolumes, stableVolumes, inVolumeStart, stableVolumesEnd, volumeLength);
        stableVolumesEnd += volumeLength;
      } else {
        write(inVolumes, outVolumes, inVolumeStart, outVolumesEnd, volumeLength);
        outVolumesEnd += volumeLength;
      }
    } else {
      // check the child hashes
      var branchWidth = this.tree.branchWidth;
      var children = node.children;
      for (var i = 0; i < branchWidth; i++) {
        var child = children[i];
        if (child !== undefined) {
          var los = nodeLos(child);
          var his = nodeHis(child);
          if (intersects(inVolumes, inVolumeStart, hashIxes, los, his, numVars)) {
            write(inVolumes, outVolumes, inVolumeStart, outVolumesEnd, volumeLength);
            overwrite(outVolumes, outVolumesEnd, hashIxes, los, his, child, numVars, myIx);
            outVolumesEnd += volumeLength;
          }
        }
      }
    }
  }
  return outVolumesEnd;
};

function solve(numVars, constraints) {
  var numConstraints = constraints.length;
  var inVolumes = [];
  var outVolumes = [];
  var stableVolumes = [];

  for (var i = 0; i < numVars; i++) {
    inVolumes[i] = minHash;
    inVolumes[numVars + i] = maxHash;
  }
  for (var i = 0; i < numConstraints; i++) {
    inVolumes[numVars + numVars + i] = constraints[i].init();
  }
  var inVolumesEnd = numVars + numVars + numConstraints;

  var constraint = 0;
  while (inVolumesEnd > 0) {
    inVolumesEnd = constraints[constraint].propagate(inVolumes, outVolumes, stableVolumes, inVolumesEnd, numVars, numConstraints, constraint);
    var tmp = outVolumes;
    outVolumes = inVolumes;
    inVolumes = tmp;
    constraint = (constraint + 1) % numConstraints;
  }

  return stableVolumes;
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
    facts.push([i + "zomg", i + "foo" + i, "beebs" + i]);
  }
  var facts2 = [];
  for (var i = 0; i < n; i++) {
    facts2.push(["beebs" + i, i + "bar", i + "quux" + i]);
  }

  console.time("insert");
  var a = ZZTree.empty(3, 4).bulkInsert(facts);
  var b = ZZTree.empty(3, 4).bulkInsert(facts2);
  console.timeEnd("insert");
  console.time("solve");
  // console.profile();
  var s = solve(5, [new ZZContains(a, [0, 1, 2]), new ZZContains(b, [2, 3, 4])]);
  // console.profileEnd();
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

  console.time("insert sort");
  facts.sort(function(a, b) {
    return a[2] < b[2] ? -1 : (a[2] > b[2] ? 1 : 0);
  });
  facts2.sort(function(a, b) {
    return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0);
  });
  console.timeEnd("insert sort");
  console.time("solve sort");
  var s3 = [];
  var ix = 0;
  var ix2 = 0;
  while ((ix < n) && (ix2 < n)) {
    var fact = facts[ix];
    var fact2 = facts2[ix2];
    var join = fact[2];
    var join2 = fact2[0];
    if (join === join2) {
      s3.push([fact[0], fact[1], fact[2], fact2[1], fact2[2]]);
      ix++;
    } else if (join < join2) {
      ix++;
    } else {
      ix2++;
    }
  }
  console.timeEnd("solve sort");

  return [s.slice(0, 10 * 12), s2.slice(0, 10), s3.slice(0, 10)];
}

// var x = bench(1000000);

function bits(n) {
  var s = "";
  for (var i = 31; i >= 0; i--) {
    s += (n >> i) & 1;
  }
  return s;
}