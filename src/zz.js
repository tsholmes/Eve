// 4 bits
// array 16
// no path compression
// mix bytes
// entirely persistent, bulk update
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
  var len = fact.length;
  var hashes = [];
  for (var i = 0; i < len; i++) {
   hashes[i] = hash(fact[i]);
  }
  var path = [];
  var pathBits = hashes.length * 32;
  var pathChunks = pathBits / branchDepth;
  for (var i = 0; i < pathChunks; i++) {
    path[i] = 0;
  }
  for (var i = 0; i < pathBits; i++) {
    var h = hashes[i % len];
    var bit = (h >> ((i / len) | 0)) & 1;
    var chunkIx = (i / branchDepth | 0);
    path[chunkIx] = path[chunkIx] | (bit << (i % branchDepth));
  }
  return path;
}

function ZZTree(branchDepth, branchWidth, root) {
  this.branchDepth = branchDepth
  this.branchWidth = branchWidth;
  this.root = root;
}

function ZZLeaf(path, values) {
  this.path = path;
  this.values = values;
}

ZZTree.prototype = {
  leaves: function() {
    var leaves = [];
    var branches = [this.root];
    while (branches.length > 0) {
      var branch = branches.pop();
      for (var i = 0; i < this.branchWidth; i++) {
        var child = branch[i];
        if (child === undefined) {
          // pass
        }
        else if (child.constructor === ZZLeaf) {
          leaves.push(child);
        } else {
          branches.push(child);
        }
      }
    }
    return leaves;
  },

  insert: function(path, value) {
    var pathIx = 0;
    var root = this.root.slice();
    var branch = root;

    down: while (true) {
      var branchIx = path[pathIx];
      pathIx++;
      var child = branch[branchIx];
      if (child === undefined) {
        branch[branchIx] = new ZZLeaf(path, [value]);
        break down;
      } else if (child.constructor === ZZLeaf) {
        if (pathIx >= path.length) {
          var values = child.values.slice();
          values.push(value);
          branch[branchIx] = new ZZLeaf(path, values);
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

  remove: function(path, value) {
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
        var values = child.values.slice();
        splice: for (var i = 0; i < values.length; i++) {
          if (values[i] === value) {
            values.splice(i, 1);
            break splice;
          }
        }
        if (values.length > 0) {
          branch[branchIx] = new ZZLeaf(child.path, values);
          return new ZZTree(this.branchDepth, this.branchWidth, root); // nothing to clean up
        } else {
          delete branch[branchIx];
          break down;
        }
      } else {
        branches.push(branch);
        var childBranch = child.slice();
        branch[branchIx] = childBranch;
        branch = childBranch;
      }
    }

    up: while (true) {
      branch = branches.pop();
      var branchIx = path[pathIx]
      pathIx--;
      delete branch[branchIx];
      for (var i = 0; i < this.branchWidth; i++) {
        if (branch[i] !== undefined) {
          break up; // done cleaning up
        }
      }
    }

    return new ZZTree(this.branchDepth, this.branchWidth, root);
  }
}

ZZTree.empty = function(branchDepth) {
  var branchWidth = Math.pow(2,branchDepth);
  return new ZZTree(branchDepth, branchWidth, Array(branchWidth));
}

var a = ZZTree.empty(1).insert([0,0,0], "a");
var b = a.insert([0,0,1], "b");
var c = b.insert([1,0,1], "c");
var d = c.insert([1,0,0], "d");
var e = d.insert([1,0,0], "e");
var f = e.remove([1,0,0], "d");
var g = f.remove([0,0,1], "b");
var h = g.remove([0,0,1], "b");