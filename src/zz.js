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

function ZZTree(factLength, branchDepth, branchWidth, root, ixes) {
  assert(branchDepth <= 8);
  this.factLength = factLength;
  this.branchDepth = branchDepth;
  this.branchWidth = branchWidth;
  this.root = root;
  this.ixes = ixes;
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

ZZLeaf.prototype.path = function(depth, pathIx, ixes) {
  var hashes = this.hashes;
  var length = ixes.length;
  var path = 0;
  var maxBitIx = length * 32;
  for (var i = 0; i < depth; i++) {
    var bitIx = maxBitIx - ((pathIx * depth) + i) - 1;
    var hash = hashes[ixes[bitIx % length]];
    var bit = (hash >> ((bitIx / length) | 0)) & 1;
    path = path | (bit << (depth - i - 1));
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
  var ixes = this.ixes;
  for (var branchIx = 0; branchIx < this.branchWidth; branchIx++) {
    buckets[branchIx] = [];
  }
  for (var i = 0, len = leaves.length; i < len; i++) {
    var leaf = leaves[i];
    var branchIx = leaf.path(this.branchDepth, pathIx, ixes);
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

ZZTree.empty = function(factLength, branchDepth, ixes) {
  var branchWidth = Math.pow(2, branchDepth);
  var root = ZZBranch.fromChildren(factLength, branchWidth, new Array(branchWidth));
  return new ZZTree(factLength, branchDepth, branchWidth, root, ixes);
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

ZZContains.prototype.init = function() {
  return this.tree.root;
};

ZZContains.prototype.propagate = function(inVolumes, outVolumes, stableVolumes, inVolumesEnd, numVars, numConstraints, myIx) {
  var volumeLength = numVars + numVars + numConstraints + 1; // los, his, states, remaining
  var stateOffset = numVars + numVars + myIx;
  var remainingOffset = numVars + numVars + numConstraints;
  var outVolumesEnd = 0;
  var stableVolumesEnd = stableVolumes.length;
  var hashIxes = this.hashIxes;
  for (var inVolumeStart = 0; inVolumeStart < inVolumesEnd; inVolumeStart += volumeLength) {
    var node = inVolumes[inVolumeStart + stateOffset];
    if (node.constructor === ZZLeaf) {
      // nothing left to do
      write(inVolumes, outVolumes, inVolumeStart, outVolumesEnd, volumeLength);
      outVolumesEnd += volumeLength;
    } else {
      // check the child hashes
      var branchWidth = this.tree.branchWidth;

      propagate: while (true) {
        var children = node.children;
        var matches = [];
        var stables = [];

        for (var i = 0; i < branchWidth; i++) {
          var child = children[i];
          if (child !== undefined) {
            if (intersects(inVolumes, inVolumeStart, hashIxes, nodeLos(child), nodeHis(child), numVars)) {
              if ((child.constructor === ZZLeaf) && (inVolumes[inVolumeStart + remainingOffset] === 1)) {
                stables.push(child);
              } else {
                matches.push(child);
              }
            }
          }
        }

        for (var i = 0, len = stables.length; i < len; i++) {
          var child = stables[i];
          write(inVolumes, stableVolumes, inVolumeStart, stableVolumesEnd, volumeLength);
          overwrite(stableVolumes, stableVolumesEnd, hashIxes, nodeLos(child), nodeHis(child), null, numVars, myIx);
          stableVolumesEnd += volumeLength;
        }

        if ((matches.length === 1) && (matches[0].constructor === ZZBranch)) {
          node = matches[0];
          continue propagate;
        } else {
          for (var i = 0, len = matches.length; i < len; i++) {
            var child = matches[i];
            write(inVolumes, outVolumes, inVolumeStart, outVolumesEnd, volumeLength);
            overwrite(outVolumes, outVolumesEnd, hashIxes, nodeLos(child), nodeHis(child), child, numVars, myIx);
            if (child.constructor === ZZLeaf) outVolumes[outVolumesEnd + remainingOffset] -= 1;
            outVolumesEnd += volumeLength;
          }
          break propagate;
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
  var volumeLength = numVars + numVars + numConstraints + 1;

  for (var i = 0; i < numVars; i++) {
    inVolumes[i] = minHash;
    inVolumes[numVars + i] = maxHash;
  }
  for (var i = 0; i < numConstraints; i++) {
    inVolumes[numVars + numVars + i] = constraints[i].init();
  }
  inVolumes[numVars + numVars + numConstraints] = numConstraints;
  var inVolumesEnd = volumeLength;

  var constraint = 0;
  var iteration = 0;
  clearVolumes();
  while (inVolumesEnd > 0) {
    console.log((inVolumesEnd / volumeLength) + " volumes");
    drawVolumes(iteration, inVolumes, inVolumesEnd, 1, 2, numVars, numConstraints, "#FF0000");
    drawVolumes(iteration, stableVolumes, stableVolumes.length, 1, 2, numVars, numConstraints, "#0000FF");
    iteration++;
    inVolumesEnd = constraints[constraint].propagate(inVolumes, outVolumes, stableVolumes, inVolumesEnd, numVars, numConstraints, constraint);
    var tmp = outVolumes;
    outVolumes = inVolumes;
    inVolumes = tmp;
    constraint = (constraint + 1) % numConstraints;
  }
  drawVolumes(iteration, stableVolumes, stableVolumes.length, 1, 2, numVars, numConstraints, "#0000FF");

  return stableVolumes;
}

// STUFF

var size = 1000;
var border = 10;

function clearVolumes() {
  // var canvas = document.getElementById("volumes");
  // canvas.width = canvas.width;
}

function drawVolumes(iteration, volumes, volumesEnd, ixA, ixB, numVars, numConstraints, color) {
  // var canvas = document.getElementById("volumes");
  // var context = canvas.getContext("2d");
  // var start = (size + border) * iteration;
  // context.fillStyle = "#000000";
  // context.fillRect(0, start - border, size, border);
  // var volumeLength = numVars + numVars + numConstraints + 1;
  // var scale = (maxHash - minHash) / size;
  // var adjust = -minHash;
  // for (var volumeStart = 0; volumeStart < volumesEnd; volumeStart += volumeLength) {
  //   var x = volumes[volumeStart + ixA];
  //   var w = volumes[volumeStart + numVars + ixA] - x;
  //   var y = volumes[volumeStart + ixB];
  //   var h = volumes[volumeStart + numVars + ixB] - y;
  //   context.fillStyle = color;
  //   context.fillRect((x + adjust) / scale, start + (y + adjust) / scale, (w / scale) + 1, (h / scale) + 1);
  // }
}

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

var counts = new Int32Array(10000);

function zzlookup(facts, keyIx, indexIx, index) {
  var results = [];
  var branchWidth = index.branchWidth;
  for (var i = 0, factsLen = facts.length; i < factsLen; i++) {
    var fact = facts[i];
    var key = hash(fact[keyIx]);
    var nodes = [index.root];
    var count = 1;
    while (nodes.length > 0) {
      var node = nodes.pop();
      if ((key >= nodeLos(node)[indexIx]) && (key <= nodeHis(node)[indexIx])) {
        if (node.constructor === ZZLeaf) {
          results.push(fact.concat(node.fact));
        } else {
          var children = node.children;
          for (var j = 0; j < branchWidth; j++) {
            var child = children[j];
            if (child !== undefined) {
              nodes.push(child);
              count++;
            }
          }
        }
      }
    }
    counts[Math.floor(Math.log(count) / Math.log(2))] += 1;
  }
  return results;
}

function numNodes(tree) {
  var leaves = 0;
  var branches = 0;
  var nodes = [tree.root];
  while (nodes.length > 0) {
    var node = nodes.pop();
    if (node.constructor === ZZLeaf) {
      leaves += 1;
    } else {
      branches += 1;
      var children = node.children;
      for (var i = 0; i < tree.branchWidth; i++) {
        var child = children[i];
        if (child !== undefined) nodes.push(child);
      }
    }
  }
  return {
    leaves: leaves,
    branches: branches
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
  var usersTree = ZZTree.empty(2, 4, [1]).bulkInsert(users);
  var loginsTree = ZZTree.empty(2, 4, [0, 1]).bulkInsert(logins);
  var bansTree = ZZTree.empty(1, 4, [0]).bulkInsert(bans);
  console.timeEnd("insert");
  console.log(usersTree, numNodes(loginsTree), numNodes(bansTree));
  console.time("solve");
  //console.profile();
  var solverResults = solve(3, [
    new ZZContains(usersTree, [0, 1]),
    new ZZContains(loginsTree, [1, 2]),
    new ZZContains(bansTree, [2])
  ]);
  //console.profileEnd();
  console.timeEnd("solve");

  console.time("insert forward");
  var loginsIndex = index(logins, 0);
  var bansIndex = index(bans, 0);
  console.timeEnd("insert forward");
  console.time("solve forward");
  var forwardResults = lookup(lookup(users, 1, loginsIndex), 3, bansIndex);
  console.timeEnd("solve forward");

  console.time("solve zz");
  //console.profile();
  var zzResults = zzlookup(zzlookup(bans, 0, 1, loginsTree), 1, 1, usersTree);
  //console.profileEnd();
  console.timeEnd("solve zz");

  console.time("insert backward");
  var usersIndex = index(users, 1);
  var loginsIndex = index(logins, 1);
  console.timeEnd("insert backward");
  console.time("solve backward");
  var backwardResults = lookup(lookup(bans, 0, loginsIndex), 1, usersIndex);
  console.timeEnd("solve backward");

  return [solverResults, forwardResults, zzResults, backwardResults];
}

// var x = bench(1000000);

function bits(n) {
  var s = "";
  for (var i = 31; i >= 0; i--) {
    s += (n >> i) & 1;
  }
  return s;
}