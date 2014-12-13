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

function minInto(runningMin, minStart, values, valuesStart, numValues) {
  while (numValues--) {
    runningMin[minStart] = Math.min(runningMin[minStart], values[valuesStart]);
    minStart++;
    valuesStart++;
  }
}

function maxInto(runningMax, maxStart, values, valuesStart, numValues) {
  while (numValues--) {
    runningMax[maxStart] = Math.max(runningMax[maxStart], values[valuesStart]);
    maxStart++;
    valuesStart++;
  }
}

function fill(array, start, numValues, value) {
  while (numValues--) {
    array[start] = value;
    start++;
  }
}

var ZZLEAF = 0;
var ZZBRANCH = 1;

// layout is: ZZLEAF, <=leafWidth * (hashes, values)
function zzleaf$new() {
  return [ZZLEAF];
}

function zzleaf$length(leaf, numValues) {
  return (leaf.length - 1) / (numValues * 2);
}

function zzleaf$append(leaf, hashesAndValues) {
  Array.prototype.push.apply(leaf, hashesAndValues);
}

function zzleaf$hashesIx(numValues, entry) {
  return 1 + (entry * 2 * numValues);
}

function zzleaf$getValues(leaf, numValues, entry) {
  var valueIx = 1 + (entry * 2 * numValues) + numValues;
  return leaf.slice(valueIx, valueIx + numValues);
}

// layout is ZZBRANCH, entries bitmask, <=branchWidth * (path, pointer, los, his)
function zzbranch$new() {
  return [ZZBRANCH, 0];
}

function zzbranch$length(branch, numValues) {
  return (branch.length - 2) / ((numValues * 2) + 2);
}

function zzbranch$losIx(numValues, entry) {
  return 2 + (entry * (2 + (2 * numValues))) + 2;
}

function zzbranch$hisIx(numValues, entry) {
  return 2 + (entry * (2 + (2 * numValues))) + 2 + numValues;
}

function zzbranch$getChild(branch, numValues, entry) {
  return branch[2 + (entry * (2 + (2 * numValues))) + 1];
}

function zzbranch$append(branch, path, node, numValues) {
  branch[1] = branch[1] | (1 << path);
  var start = branch.length;
  branch[start] = path;
  branch[start + 1] = node;
  var loIx = start + 2;
  var hiIx = start + 2 + numValues;
  fill(branch, loIx, numValues, maxHash);
  fill(branch, hiIx, numValues, minHash);
  if (node[0] === ZZLEAF) {
    var numEntries = zzleaf$length(node, numValues);
    for (var entry = 0; entry < numEntries; entry++) {
      minInto(branch, loIx, node, zzleaf$hashesIx(numValues, entry), numValues);
      maxInto(branch, hiIx, node, zzleaf$hashesIx(numValues, entry), numValues);
    }
  } else {
    var numEntries = zzbranch$length(node, numValues);
    for (var entry = 0; entry < numEntries; entry++) {
      minInto(branch, loIx, node, zzbranch$losIx(numValues, entry), numValues);
      maxInto(branch, hiIx, node, zzbranch$hisIx(numValues, entry), numValues);
    }
  }
}

function withHashes(values) {
  var hashesAndValues = [];
  for (var i = 0, len = values.length; i < len; i++) {
    var value = values[i];
    hashesAndValues[i] = hash(value);
    hashesAndValues[len + i] = value;
  }
  return hashesAndValues;
}

function pathAt(hashesAndValues, branchDepth, pathIx, ixes) {
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
}

function ZZTree(numValues, leafWidth, branchWidth, branchDepth, ixes, root) {
  this.numValues = numValues;
  this.leafWidth = leafWidth;
  this.branchWidth = branchWidth;
  this.branchDepth = branchDepth;
  this.ixes = ixes;
  this.root = root;
}

ZZTree.prototype.bucketSort = function(inserts, pathIx) {
  var buckets = [];
  var ixes = this.ixes;
  var branchWidth = this.branchWidth;
  var branchDepth = this.branchDepth;
  for (var path = 0; path < branchWidth; path++) {
    buckets[path] = [];
  }
  for (var i = 0, len = inserts.length; i < len; i++) {
    var insert = inserts[i];
    var path = pathAt(insert, branchDepth, pathIx, ixes);
    buckets[path].push(insert);
  }
  return buckets;
};

ZZTree.prototype.buildNodeFrom = function(inserts, pathIx) {
  var numInserts = inserts.length;
  if (numInserts <= this.leafWidth) {
    var leaf = zzleaf$new();
    for (var i = 0; i < numInserts; i++) {
      zzleaf$append(leaf, inserts[i]);
    }
    return leaf;
  } else {
    var branch = zzbranch$new();
    var buckets = this.bucketSort(inserts, pathIx);
    var branchWidth = this.branchWidth;
    for (var path = 0; path < branchWidth; path++) {
      var bucket = buckets[path];
      if (bucket.length > 0) {
        zzbranch$append(branch, path, this.buildNodeFrom(bucket, pathIx + 1), this.numValues);
      }
    }
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
    // TODO pathIx is at max just make a big leaf
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
  return new ZZTree(numValues, leafWidth, branchWidth, branchDepth, ixes, zzleaf$new());
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

function intersects(volumes, volumeStart, node, losIx, hisIx, ixes, numVars) {
  var outOfBounds = false;
  for (var i = 0, len = ixes.length; i < len; i++) {
    var ix = ixes[i];
    outOfBounds = outOfBounds ||
      (node[hisIx + i] < volumes[volumeStart + ix]) ||
      (node[losIx + i] > volumes[volumeStart + numVars + ix]);
  }
  return !outOfBounds;
}

function overwrite(volumes, volumeStart, node, losStart, hisStart, ixes, numVars) {
  for (var i = 0, len = ixes.length; i < len; i++) {
    var ix = ixes[i];
    var loIx = volumeStart + ix;
    var hiIx = volumeStart + numVars + ix;
    volumes[loIx] = Math.max(volumes[loIx], node[losStart + i]);
    volumes[hiIx] = Math.min(volumes[hiIx], node[hisStart + i]);
  }
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
  var numValues = this.tree.numValues;
  for (var inVolumeStart = 0; inVolumeStart < inVolumesEnd; inVolumeStart += volumeLength) {
    var node = inVolumes[inVolumeStart + stateOffset];
    propagate: while (true) {
      if (node === null) {
        // nothing left to do
        write(inVolumes, outVolumes, inVolumeStart, outVolumesEnd, volumeLength);
        outVolumesEnd += volumeLength;
        break propagate;
      } else if (node[0] === ZZLEAF) {
        // split on leaf entries
        var numEntries = zzleaf$length(node, numValues);
        inVolumes[inVolumeStart + remainingOffset] -= 1;
        var isStable = inVolumes[inVolumeStart + remainingOffset] === 0;
        var destination = isStable ? stableVolumes : outVolumes;
        for (var entry = 0; entry < numEntries; entry++) {
          if (intersects(inVolumes, inVolumeStart, node, zzleaf$hashesIx(numValues, entry), zzleaf$hashesIx(numValues, entry), hashIxes, numVars)) {
            var destinationEnd = isStable ? stableVolumesEnd : outVolumesEnd;
            write(inVolumes, destination, inVolumeStart, destinationEnd, volumeLength);
            overwrite(destination, destinationEnd, node, zzleaf$hashesIx(numValues, entry), zzleaf$hashesIx(numValues, entry), hashIxes, numVars);
            destination[destinationEnd + stateOffset] = null;
            if (isStable) {
              stableVolumesEnd += volumeLength;
            } else {
              outVolumesEnd += volumeLength;
            }
          }
        }
        break propagate;
      } else {
        // split on branch entries
        var matches = [];
        var numEntries = zzbranch$length(node, numValues);
        for (var entry = 0; entry < numEntries; entry++) {
          if (intersects(inVolumes, inVolumeStart, node, zzbranch$losIx(numValues, entry), zzbranch$hisIx(numValues, entry), hashIxes, numVars)) {
            matches.push(entry);
          }
        }
        if (matches.length === 1) {
          node = zzbranch$getChild(node, numValues, matches[0]);
          continue propagate;
        } else {
          for (var i = 0, len = matches.length; i < len; i++) {
            var entry = matches[i];
            write(inVolumes, outVolumes, inVolumeStart, outVolumesEnd, volumeLength);
            overwrite(outVolumes, outVolumesEnd, node, zzbranch$losIx(numValues, entry), zzbranch$hisIx(numValues, entry), hashIxes, numVars);
            outVolumes[outVolumesEnd + stateOffset] = zzbranch$getChild(node, numValues, entry);
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
  for (var i = 0, factsLen = facts.length; i < factsLen; i++) {
    var fact = facts[i];
    var key = hash(fact[keyIx]);
    var numValues = index.numValues;
    var nodes = [index.root];
    var count = 1;
    while (nodes.length > 0) {
      var node = nodes.pop();
      if (node[0] === ZZBRANCH) {
        var numEntries = zzbranch$length(node, numValues);
        for (var entry = 0; entry < numEntries; entry++) {
          if ((key >= node[zzbranch$losIx(numValues, entry) + indexIx]) &&
            (key <= node[zzbranch$hisIx(numValues, entry) + indexIx])) {
            nodes.push(zzbranch$getChild(node, numValues, entry));
          }
        }
      } else {
        var numEntries = zzleaf$length(node, numValues);
        for (var entry = 0; entry < numEntries; entry++) {
          if (key === node[zzleaf$hashesIx(numValues, entry) + indexIx]) {
            results.push(fact.concat(zzleaf$getValues(node, numValues, entry)));
          }
        }
      }
      counts[Math.floor(Math.log(count) / Math.log(2))] += 1;
    }
  }
  return results;
}

function numNodes(tree) {
  var leaves = 0;
  var branches = 0;
  var numValues = tree.numValues;
  var nodes = [tree.root];
  while (nodes.length > 0) {
    var node = nodes.pop();
    if (node[0] === ZZLEAF) {
      leaves += 1;
    } else {
      branches += 1;
      var numEntries = zzbranch$length(node, numValues);
      for (var entry = 0; entry < numEntries; entry++) {
        nodes.push(zzbranch$getChild(node, numValues, entry));
      }
    }
  }
  return {
    leaves: leaves,
    branches: branches
  };
}

function bench(numUsers, numLogins, numBans, leafWidth, branchDepth) {
  leafWidth = leafWidth || 16;
  branchDepth = branchDepth || 1;
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
  console.log(usersTree, loginsTree, bansTree);
  console.log(numNodes(usersTree), numNodes(loginsTree), numNodes(bansTree));
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
  // var zzResults = zzlookup(zzlookup(bans, 0, 1, loginsTree), 1, 1, usersTree);
  //console.profileEnd();
  console.timeEnd("solve zz");

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