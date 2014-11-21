// 4 bits
// array 16
// no path compression
// mix bytes
// entirely persistent, bulk update- sort by path and return finish ix
// counting of values
// how to walk up on delete? return true/false for empty?
// leaves are just non-nodes?

function hash(value) {
  if (typeof(value) === 'number') {
    return value;
  } else if (typeof(value) === 'string') {
    var hash = 0, i, chr, len;
    if (value.length == 0) return hash;
    for (i = 0, len = value.length; i < len; i++) {
      hash = (((hash << 5) - hash) + value.charCodeAt(i)) | 0;
    }
    return hash;
  } else {
    throw new Error("What is " + typeof(value) + ": " + value);
  }
};

function makePath(branchDepth, fact) {
  assert(branchDepth <= 8);
  var len = fact.length;
  var hashes = [];
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
    var chunkIx = (i / branchDepth | 0);
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

function ZZLeaf(path, facts) {
  this.path = path;
  this.facts = facts;
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
          Array.prototype.push.apply(facts, child.facts);
        } else {
          branches.push(child);
        }
      }
    }
    return facts;
  },

  insert: function(fact) {
    var path = makePath(this.branchDepth, fact);
    var pathIx = 0;
    var root = this.root.slice();
    var branch = root;

    down: while (true) {
      var branchIx = path[pathIx];
      pathIx++;
      var child = branch[branchIx];
      if (child === undefined) {
        branch[branchIx] = new ZZLeaf(path, [fact]);
        break down;
      } else if (child.constructor === ZZLeaf) {
        if (arrayEqual(path, child.path)) { // TODO this is an expensive check?
          var facts = child.facts.slice();
          facts.push(fact);
          branch[branchIx] = new ZZLeaf(path, facts);
          break down;
        } else {
          var childBranch = Array(this.branchWidth);
          childBranch[child.path[pathIx]] = child;
          branch[branchIx] = childBranch;
          branch = childBranch;
          continue down;
        }
      } else {
        var childBranch = child.slice();
        branch[branchIx] = childBranch;
        branch = childBranch;
        continue down;
      }
    }

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

ZZTree.empty = function(branchDepth) {
  var branchWidth = Math.pow(2,branchDepth);
  return new ZZTree(branchDepth, branchWidth, Array(branchWidth));
}

var a = ZZTree.empty(1)
.insert(["foo", 0])
.insert(["bar", 0])
.insert([0, 0])
.insert(["foo", "bar"])
.insert(["foo", "bar"])
.insert(["foo", "bar"])

var b = a
.remove(["foo", 0])
.remove(["foo", "bar"])