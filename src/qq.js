function path(value, bitsBefore, bitsAfter) {
	var length = Math.min(bitsAfter, 4); // max 4 bits in chunk
	var chunk = (value >> (32 - bitsBefore - length)) & ((1 << length) - 1); // grab `length` bits from position `bitsBefore`
	return chunk + (1 << length) - 1; // stagger path so that there is space for all combinations of 0-4 bits
}

function population(v) {
	var c;
	c = v - ((v >> 1) & 0x55555555);
	c = ((c >> 2) & 0x33333333) + (c & 0x33333333);
	c = ((c >> 4) + c) & 0x0F0F0F0F;
	c = ((c >> 8) + c) & 0x00FF00FF;
	c = ((c >> 16) + c) & 0x0000FFFF;
	return c;
}

// TESTS

function slowPopulation(v) {
	var c = 0;
	for (var i = 0; i < 32; i++) {
		c += (v >> i) & 1;
	}
	return c;
}

function testPopulation(n) {
	for (var i = 0; i < n; i++) {
		var v = (Math.random() * Math.pow(2, 32)) | 0;
		if (population(v) !== slowPopulation(v)) throw ("Failed on " + v);
	}
}

function bits(n) {
	var s = "";
	for (var i = 31; i >= 0; i--) {
		s += (n >> i) & 1;
	}
	return s;
}