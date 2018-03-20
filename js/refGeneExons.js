'use strict';

var _ = require('./underscore_ext');
var React = require('react');
var ReactDOM = require('react-dom');
var Rx = require('./rx');
var intervalTree = require('static-interval-tree');
var vgcanvas = require('./vgcanvas');
var layoutPlot = require('./layoutPlot');
var {matches, index} = intervalTree;
var {pxTransformEach} = layoutPlot;
var {rxEvents} = require('./react-utils');
var util = require('./util');
var {chromPositionFromScreen} = require('./exonLayout');

// annotate an interval with cds status
var inCds = ({cdsStart, cdsEnd}, intvl) =>
	_.assoc(intvl, 'inCds', intvl.start <= cdsEnd && cdsStart <= intvl.end);

// split an interval at pos if it overlaps
var splitOnPos = (pos, i) => (i.start < pos && pos <= i.end) ?
		[_.assoc(i, 'end', pos - 1), _.assoc(i, 'start', pos)] : i;

// create interval record
var toIntvl = (start, end, i) => ({start: start, end: end, i: i});

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

var shade1 = '#cccccc',
	shade2 = '#999999',
	shade3 = '#000080';

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

var RefGeneAnnotation = React.createClass({
	componentWillMount: function () {
		var events = rxEvents(this, 'mouseout', 'mousemove', 'mouseover');

		// Compute tooltip events from mouse events.
		this.ttevents = events.mouseover
			.filter(ev => util.hasClass(ev.currentTarget, 'Tooltip-target'))
			.flatMap(() => {
				return events.mousemove
					.takeUntil(events.mouseout)
					.map(ev => ({
						data: this.tooltip(ev),
						open: true
					})) // look up current data
					.concat(Rx.Observable.of({open: false}));
			}).subscribe(this.props.tooltip);
	},
	componentWillUnmount: function () {
		this.ttevents.unsubscribe();
	},
	componentDidMount: function () {
		var {width, height} = this.props;
		this.vg = vgcanvas(ReactDOM.findDOMNode(this.refs.canvas), width, height);
		this.draw(this.props);
	},
	shouldComponentUpdate() {
		return false;
	},
	componentWillReceiveProps(newProps) {
		if (this.vg && !_.isEqual(newProps, this.props)) {
			this.draw(newProps);
		}
	},
	computeAnnotationLanes({position, refGene, height, column}) {
		var fieldType = _.get(column, 'fieldType', undefined),
			newAnnotationLanes;

		if (['segmented', 'mutation', 'SV'].indexOf(fieldType) !== -1 && position && refGene) {
			var lanes = [],
				[start, end] = position;

			//only keep genes with in the current view
			refGene = _.values(refGene).filter((val) => {
				return ((val.txStart <= end) && (val.txEnd >= start));
			});

			//multip lane no-overlapping genes
			refGene.forEach( val => {
				var added = lanes.some(lane => {
					if (lane.every( gene => !((val.txStart <= gene.txEnd) && (val.txEnd >= val.txStart)))) {
						return lane.push(val);
					}
				});
				if (!added) { // add a new lane
					lanes.push([val]);
				}
			});
			var perLaneHeight = _.min([height / lanes.length, 12]),
				laneOffset = (height - perLaneHeight * lanes.length) / 2;

			newAnnotationLanes = {
				lanes: lanes,
				perLaneHeight: perLaneHeight,
				laneOffset: laneOffset,
				annotationHeight: height
			};
		} else {
			newAnnotationLanes = {
				lanes: undefined,
				perLaneHeight: undefined,
				laneOffset: undefined,
				annotationHeight: height
			};
		}
		// cache for tooltip
		this.annotationLanes = newAnnotationLanes;
	},
	draw: function (props) {
		var {width, layout, mode} = props;
		this.computeAnnotationLanes(props);
		var {lanes, perLaneHeight, laneOffset, annotationHeight} = this.annotationLanes;

		// white background
		this.vg.box(0, 0, width, annotationHeight, 'white');

		if (!width || !layout) {
			return;
		}
		var vg = this.vg;
//			ctx = vg.context();

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

					drawIntroArrows (vg, pGeneStart, pGeneEnd, lineY, segments, mode === 'coordinate' ? gene.strand : '+');

					// draw each segment
					_.each(segments, ([pstart, pend, shade, y, h]) => {
						var segment = [[pstart, y, (pend - pstart) || 1, h]];
						vg.drawRectangles(segment, {fillStyle: shade, strokeStyle: "", lineWdth: .1});
					});
				});
			});
		});
	},
	tooltip: function (ev) {
		var {layout, column: {assembly}} = this.props;

		if (!layout) { // gene model not loaded
			return;
		}
		var {x, y} = util.eventOffset(ev),
			{annotationHeight, perLaneHeight, laneOffset, lanes} = this.annotationLanes,
			rows = [],
			assemblyString = encodeURIComponent(assembly),
			contextPadding = Math.floor((layout.zoom.end - layout.zoom.start) / 4),
			posLayout = `${layout.chromName}:${util.addCommas(layout.zoom.start)}-${util.addCommas(layout.zoom.end)}`,
			posLayoutPadding = `${layout.chromName}:${util.addCommas(layout.zoom.start - contextPadding)}-${util.addCommas(layout.zoom.end + contextPadding)}`,
			posLayoutString = encodeURIComponent(posLayout),
			posLayoutPaddingString = encodeURIComponent(posLayoutPadding),
			GBurlZoom = `http://genome.ucsc.edu/cgi-bin/hgTracks?db=${assemblyString}&highlight=${assemblyString}.${posLayoutString}&position=${posLayoutPaddingString}`;

		if (y > laneOffset && y < annotationHeight - laneOffset) {
			var posStart = chromPositionFromScreen(layout, x - 0.5),
				posEnd = chromPositionFromScreen(layout, x + 0.5),
				matches = [],
				laneIndex = Math.floor((y - laneOffset) / perLaneHeight); //find which lane by y

			lanes[laneIndex].forEach(gene => {
				if ((posEnd >= gene.txStart) && (posStart <= gene.txEnd)) {
					matches.push(gene);
				}
			});

			if (matches.length > 0)	{
				matches.forEach(match => {
					var posGene = `${match.chrom}:${util.addCommas(match.txStart)}-${util.addCommas(match.txEnd)}`,
						positionGeneString = encodeURIComponent(posGene),
						GBurlGene = `http://genome.ucsc.edu/cgi-bin/hgTracks?db=${assemblyString}&position=${positionGeneString}&enableHighlightingDialog=0`;

					rows.push([['value', 'Gene '], ['url', `${match.name2}`, GBurlGene]]);
				});
			}
		}

		rows.push([['value', 'Column'], ['url', `${assembly} ${posLayout}`, GBurlZoom]]);
		return {
			rows: rows
		};
	},
	render: function () {
		return (
			<canvas
				className='Tooltip-target'
				onMouseMove={this.on.mousemove}
				onMouseOut={this.on.mouseout}
				onMouseOver={this.on.mouseover}
				onClick={this.props.onClick}
				onDblClick={this.props.onDblClick}
				ref='canvas' />
		);
	}
});

//widgets.annotation.add('gene', props => <RefGeneAnnotation {...props}/>);

module.exports = {
	findIntervals: findIntervals,
	RefGeneAnnotation: RefGeneAnnotation
};
