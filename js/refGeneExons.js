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
var drawGene = require('./drawGene');


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
		
		drawGene.draw(this.vg, this.annotationLanes, width, layout, mode);
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
	RefGeneAnnotation: RefGeneAnnotation
};
