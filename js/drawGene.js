'use strict';

/*
 * API indipendent drawing function
 * that renders gene 
 */

var intervalTree = require('static-interval-tree');
var layoutPlot = require('./layoutPlot');
var {matches, index} = intervalTree;
var {pxTransformEach} = layoutPlot;
var _ = require('./underscore_ext');

var shade1 = '#cccccc',
	shade2 = '#999999',
	shade3 = '#000080';

// draw arrows in introns (zoom if necessary to see them)
function drawIntroArrows (vg, xStart, xEnd, endY, segments, strand) {
	if (xEnd - xStart < 10) {
		return;
	}
	var arrowSize = 2, //arrowSize
		gapSize = 4;

	for (var i = xStart; i < xEnd; i = i + 10) {
		var found = segments.filter(seg => (Math.abs(seg[0] - i) < gapSize ||
				Math.abs(seg[0] - i - arrowSize) < gapSize ||
				Math.abs(seg[1] - i) < gapSize ||
				Math.abs(seg[1] - i - arrowSize) < gapSize));

	var plusStrand = [[i, endY - arrowSize, i + arrowSize, endY], [i, endY + arrowSize, i + arrowSize, endY]],
		minusStrand = [[i + arrowSize, endY - arrowSize, i, endY], [i + arrowSize, endY + arrowSize, i, endY]];

		if (_.isEmpty(found)) {
			if (strand === '+') {
				vg.drawPoly(plusStrand, {fillStyle: [0, 0, 0], strokeStyle: [0, 0, 0], lineWidth: ""});
			} else { // "-" strand
    			vg.drawPoly(minusStrand, {fillStyle: [0, 0, 0], strokeStyle: [0, 0, 0], lineWidth: ""});
			}
		}
	}
}

function getAnnotation (index, perLaneHeight, offset) {
	return {
		utr: {
			y: offset + perLaneHeight * (index + 0.25),
			h: perLaneHeight / 2
		},
		cds: {
			y: offset + perLaneHeight * index,
			h: perLaneHeight
		}
	};
}

// Create drawing intervals, by spliting exons on cds bounds, and annotating if each
// resulting region is in the cds. Each region is also annotated by its index in the
// list of exons, so we can alternate colors when rendering.
//
// findIntervals(gene :: {cdsStart :: int, cdsEnd :: int, exonStarts :: [int, ...], exonEnds :: [int, ...]})
//     :: [{start :: int, end :: int, i :: int, inCds :: boolean}, ...]
function findIntervals(gene) {
	if (_.isEmpty(gene)) {
		return [];
	}
	var {cdsStart, cdsEnd, exonStarts, exonEnds} = gene;

	return _.map(_.flatmap(_.flatmap(_.zip(exonStarts, exonEnds),
									([s, e], i) => splitOnPos(cdsStart, toIntvl(s, e, i))),
							i => splitOnPos(cdsEnd + 1, i)),
				i => inCds(gene, i));
}

// annotate an interval with cds status
var inCds = ({cdsStart, cdsEnd}, intvl) =>
	_.assoc(intvl, 'inCds', intvl.start <= cdsEnd && cdsStart <= intvl.end);

// split an interval at pos if it overlaps
var splitOnPos = (pos, i) => (i.start < pos && pos <= i.end) ?
		[_.assoc(i, 'end', pos - 1), _.assoc(i, 'start', pos)] : i;

// create interval record
var toIntvl = (start, end, i) => ({start: start, end: end, i: i});


var draw = function(vgctx, annotationLanes, width, layout, mode) {
	//vg context can be either vgcanvas or vgpdf
	var vg = vgctx;
	var {lanes, perLaneHeight, laneOffset, annotationHeight} = annotationLanes;
	
	// white background
	vg.box(0, 0, width, annotationHeight, 'white');

	if (!width || !layout) {
		return;
	}

	if (vg.width() !== width) {
		vg.width(width);
	}

	if ( _.isEmpty(layout.chrom) || _.isEmpty(lanes)) {
		return;
	}

	//drawing start here, one lane at a time
	lanes.forEach((lane, k) => {
		var annotation = getAnnotation(k, perLaneHeight, laneOffset);

		lane.forEach(gene => {
			var intervals = findIntervals(gene),
				indx = index(intervals),
				lineY = laneOffset + perLaneHeight * (k + 0.5);

			//find segments for one gene
			pxTransformEach(layout, (toPx, [start, end]) => {
				var nodes = matches(indx, {start: start, end: end}),
					segments = nodes.map(({i, start, end, inCds}) => {
						var {y, h} = annotation[inCds ? 'cds' : 'utr'],
							[pstart, pend] = toPx([start, end]),
							shade = (mode === "geneExon") ?
								(i % 2 === 1 ? shade1 : shade2) :
								(mode === "coordinate" ? shade3 : shade2);
						return [pstart, pend, shade, y, h];
					}),
					[pGeneStart, pGeneEnd] = toPx([gene.txStart, gene.txEnd]);

				// draw a line across the gene
				var lineOnGene = [[pGeneStart, lineY, pGeneEnd - pGeneStart, 1]];
				vg.drawRectangles(lineOnGene, {fillStyle: shade2, strokeStyle: 'white', lineWdth: .1});

				// draw arrows in introns
				drawIntroArrows (vg, pGeneStart, pGeneEnd, lineY, segments, mode === 'coordinate' ? gene.strand : '+');

				// draw each segment
				_.each(segments, ([pstart, pend, shade, y, h]) => {
					var segment = [[pstart, y, (pend - pstart) || 1, h]];
					vg.drawRectangles(segment, {fillStyle: shade, strokeStyle: "", lineWdth: .1});
				});
			});
		});
	});
}

module.exports = {
	draw: draw
};
