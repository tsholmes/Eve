// --- from cljs.core ---

function int_rotate_left(x,n) {
  return ((x << n) | (x >>> (- n)));
};

var m3_seed = 0;
var m3_C1 = 3432918353;
var m3_C2 = 461845907;

function m3_mix_K1(k1) {
  return Math.imul(int_rotate_left(Math.imul(k1,m3_C1),(15)),m3_C2);
}

function m3_mix_H1(h1,k1) {
  return (Math.imul(int_rotate_left((h1 ^ k1),(13)),(5)) + (3864292196));
}

function m3_fmix(h1,len) {
  var h1__$1 = h1;
  var h1__$2 = (h1__$1 ^ len);
  var h1__$3 = (h1__$2 ^ (h1__$2 >>> (16)));
  var h1__$4 = Math.imul(h1__$3,(2246822507));
  var h1__$5 = (h1__$4 ^ (h1__$4 >>> (13)));
  var h1__$6 = Math.imul(h1__$5,(3266489909));
  var h1__$7 = (h1__$6 ^ (h1__$6 >>> (16)));
  return h1__$7;
}

function m3_hash_int(in$) {
  var k1 = m3_mix_K1(in$);
  var h1 = m3_mix_H1(m3_seed,k1);
  return m3_fmix(h1,(4));
}

function hash_string(s) {
  var hash = 0;
  for (var i = 0, len = s.length; i < len; i++) {
    hash = Math.imul(31,hash) + s.charCodeAt(i);
  }
  return hash;
};

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

function pathEqual(a, b) {
  var len = a.length;
  for(var i = 0; i < len; i++) {
    if(a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function comparePath(as, bs) {
  var len = as.length;
  for(var i = 0; i < len; i++) {
    var a = as[i];
    var b = bs[i];
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

function makePath(branchDepth, fact) {
  assert(branchDepth <= 8);
  var len = fact.length;
  var hashes = new Int32Array(fact.length);
  for (var i = 0; i < len; i++) {
   hashes[i] = hash(fact[i]);
  }
  var path = [];
  var pathBits = hashes.length * 32;
  var pathChunks = pathBits / branchDepth;
  var path = new Uint8Array(pathChunks);
  for (var i = 0; i < pathBits; i++) {
    var h = hashes[i % len];
    var bit = (h >> ((i / len) | 0)) & 1;
    var chunkIx = (i / branchDepth) | 0;
    path[chunkIx] = path[chunkIx] | (bit << (i % branchDepth));
  }
  return path;
}

function ZZTree(branchDepth, branchWidth, root) {
  assert(branchDepth <= 8);
  this.branchDepth = branchDepth
  this.branchWidth = branchWidth;
  this.root = root;
}

function ZZLeaf(path, fact) {
  this.path = path;
  this.fact = fact;
}

ZZTree.prototype = {
  facts: function() {
    var facts = [];
    var branches = [this.root];
    while (branches.length > 0) {
      var branch = branches.pop();
      for (var i = 0; i < this.branchWidth; i++) {
        var child = branch[i];
        if (child === undefined) {
          // pass
        }
        else if (child.constructor === ZZLeaf) {
          facts.push(child.fact);
        } else {
          branches.push(child);
        }
      }
    }
    return facts;
  },

  bulkInsertToBranch: function(branch, pathIx, leaves) {
    assert(pathIx < leaves[0].path.length); // TODO handle collisions
    var buckets = [];
    for (var branchIx = 0; branchIx < this.branchWidth; branchIx++) {
      buckets[branchIx] = [];
    }
    for (var i = 0, len = leaves.length; i < len; i++) {
      var leaf = leaves[i];
      var branchIx = leaf.path[pathIx];
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
            var childBranch = Array(this.branchWidth);
            branch[branchIx] = childBranch;
            this.bulkInsertToBranch(childBranch, pathIx+1, bucket);
          }
        } else if (child.constructor === ZZLeaf) {
          var childBranch = Array(this.branchWidth);
          assert(pathIx+1 < leaves[0].path.length); // TODO handle collisions
          branch[branchIx] = childBranch;
          childBranch[child.path[pathIx+1]] = child;
          this.bulkInsertToBranch(childBranch, pathIx+1, bucket);
        } else {
          var childBranch = child.slice();
          branch[branchIx] = childBranch;
          this.bulkInsertToBranch(childBranch, pathIx+1, bucket);
        }
      }
    }
  },

  bulkInsert: function(facts) {
    var leaves = [];
    var branchDepth = this.branchDepth;
    for (var i = 0, len = facts.length; i < len; i++) {
      var fact = facts[i];
      leaves[i] = new ZZLeaf(makePath(branchDepth, fact), fact);
    }
    var root = this.root.slice();
    this.bulkInsertToBranch(root, 0, leaves);
    return new ZZTree(this.branchDepth, this.branchWidth, root);
  },

  remove: function(fact) {
    var path = makePath(this.branchDepth, fact);
    var pathIx = 0;
    var root = this.root.slice();
    var branch = root;
    var branches = [];

    down: while (true) {
      var branchIx = path[pathIx];
      pathIx++;
      var child = branch[branchIx];
      if (child === undefined) {
        return new ZZTree(this.branchDepth, this.branchWidth, root); // nothing to clean up
      } else if (child.constructor === ZZLeaf) {
        var facts = child.facts.slice();
        splice: for (var i = 0; i < facts.length; i++) {
          if (arrayEqual(facts[i], fact)) {
            facts.splice(i, 1);
            break splice;
          }
        }
        if (facts.length > 0) {
          branch[branchIx] = new ZZLeaf(child.path, facts);
          return new ZZTree(this.branchDepth, this.branchWidth, root); // nothing to clean up
        } else {
          break down; // go clean up
        }
      } else {
        branches.push(branch);
        var childBranch = child.slice();
        branch[branchIx] = childBranch;
        branch = childBranch;
        continue down;
      }
    }

    up: while (true) {
      pathIx--;
      var branchIx = path[pathIx]
      delete branch[branchIx];
      for (var i = 0; i < this.branchWidth; i++) {
        if (branch[i] !== undefined) {
          break up; // done cleaning up
        }
      }
      branch = branches.pop();
    }

    return new ZZTree(this.branchDepth, this.branchWidth, root);
  }
}

// TODO zztree.validate

ZZTree.empty = function(branchDepth) {
  var branchWidth = Math.pow(2,branchDepth);
  return new ZZTree(branchDepth, branchWidth, Array(branchWidth));
}

var a = ZZTree.empty(1).bulkInsert([["foo", 0],
                                    ["bar", 0],
                                    [0, 0],
                                    ["foo", "bar"]]);

// var b = a
// .remove(["foo", 0])
// .remove(["foo", "bar"])

function bench(n) {
  var facts = [];
  for(var i = 0; i < n; i++) {
    facts.push([i + "zomg", i + "foo" + i, i + "asdfasd" + i]);
  }
  var time = now();
  console.time("insert");
  console.profile("insert" + time);
  var t = ZZTree.empty(4).bulkInsert(facts);
  console.profileEnd("insert" + time);
  console.timeEnd("insert");
//   console.time("obj");
//   var x = {};
//   for (var i = 0; i < n; i++) {
//     x[facts[i]] = true;
//   }
//   console.timeEnd("obj");
  return t;
}

// var x = bench(1000000);
