/*
* Copyright (c) 2013-2014 Diogo S. Martins <diogosm@icmc.usp.br>
* Intermidia Lab, Universidade de Sao Paulo, ICMC, Brazil
* <http://intermidia.icmc.usp.br/>
* 
* License: http://www.gnu.org/licenses/gpl.html GPL version 2 or higher
*/

/*
 * ActiveTimesheets engine
 * Parsing and scheduling of a multimedia presentation in the ActiveTimesheets
 * language. ActiveTimesheets extends the SMIL Timesheets language with 
 * additional SMIL modules and a number of novel features.
 * - Additional modules: Timing manipulations, Linking, Metainformation, Media
 * 		clipping
 * - Novel features: dynamic modifications, reuse features and media fragments
 *
 * REQUIRES: jquery, mediafragments
 */

ACTIVETIMESHEETS = {};

ACTIVETIMESHEETS.conf = (function ($) {
	var exports = {
		'youtube.api': '//www.youtube.com/iframe_api'
	};

	return exports;
})(jQuery);

ACTIVETIMESHEETS.util = (function ($) {
/**
* utility libraries for the engine
*/
"use strict";

var exports = {};

function TmpCtr() {};

exports.inherits = function(Parent, Child) {
	/**
	* setup inheritance in a way to avoid duplicate properties
	*/
	TmpCtr.prototype = Parent.prototype;
	Child.prototype = new TmpCtr();
	Child._superClass = Parent.prototype;
	Child.prototype.constructor = Child;
}

exports.TimegraphFormatter = function () {
	/**
	* dump representations of a timegraph for debugging purposes
	*/
	var round_units = false;
	var suppress_ids = false;

	function _toJSON(tg) {
		/**
		* 1. build a json representation for the node
		* 2. build a json representation for each child, in order, if container
		*
		* todo round the time units when specified
		*/
		var node = {};
		var type = tg.getType();
		var interval = tg._active_interval;

		node[type] = {};
		if (!suppress_ids)
			node[type]['id'] = tg._node_id;
		node[type]['begin'] = (round_units) ? Math.floor(interval.begin) : interval.begin;
		node[type]['end'] = (round_units) ? Math.floor(interval.end) : interval.end;
		if (type == 'par' || type == 'seq' || type == 'exc') {
			var children = tg.getChildren();

			node[type]['children'] = [];
			for (var i = 0; i < children.length; i++)
				node[type]['children'].push(_toJSON(children[i]));
		}

		return node;
	}

	function _toHierarchyStr(tg, _ident, timing) {
		var str = '';
		var type = tg.getType();
		var interval = tg._active_interval;
		var ident = _ident || '   ';
		var child_nodes = null;

		str += type + ' (' + tg._node_id + ') ' + '[' + interval.begin + ',' 
			+ interval.end + ']';
		if (/cm|par|seq|excl/i.test(type))
			str += '[' + tg._clipped_interval.begin + ',' + tg._clipped_interval.end + ']';
		str += ' ' + tg._state;
		str += ' ' + tg._speed + 'x';
		str += ' ' + tg._volume + 'v';
		if (timing)
			str += ' - ' +  tg.getTime()  + '\n';
		else
			str += '\n';
		if (type == 'par' || type == 'seq' || type == 'excl')
			// containers: child elements + links
			child_nodes = tg._children.concat(tg._links);
		else 
			// only links
			child_nodes = tg._links;
		for (var i = 0; i < child_nodes.length; i++) {
			var child = child_nodes[i];

			str += ident + _toHierarchyStr(child, ident + '  ', timing);
		}

		return str;
	}

	this.toJSON = function (tg, round, suppress) {
		/**
		* serializes a timegraph to JSON.
		*
		* @param tg a timegraph
		* @param round whether time values should be rounded to integers
		* @param suppress whether node ids should suppressed in the result
		*/
		round_units = round;
		suppress_ids = suppress;

		return _toJSON(tg);
	};

	this.toHierarchyStr = function (tg, timing) {
		return '\n' + _toHierarchyStr(tg, null, timing || false);
	};
};

function HeapNode(_pri, _value) {
	/**
	* a heap node; the heap property is kept according 
	* to the pri 'value'
	*/
	this._pri = _pri;
	this._value = _value;
}

function Heap(_elements) {
	/**
	* _elements: an array of pairs [pri,value] as initial data
	* _size: the capacity of the heap
	*/
	this._heap = [];
	this._heapSize = _elements.length;
	for (var i = 0; i < _elements.length; i++) {
		var el = _elements[i];

		this._heap.push(new HeapNode(el[0], el[1]));
	}
}

function MinPriorityQueue() {
	/**
	* heap-based priority queue
	* 
	*/
	this._heap = new Heap([]);
}

MinPriorityQueue.prototype.size = function () {
	return this._heap._heapSize;
};

MinPriorityQueue.prototype.clear = function() {
	this._heap = new Heap([]);
};

MinPriorityQueue.prototype.build = function (a) {
	this._buildMinHeap(a);
}

MinPriorityQueue.prototype.min = function () {
	/**
	* retrieves the min element of the queue without dequeueing it
	*/
	var res = Infinity;
	var h = this._heap;

	if (h._heapSize > 0) 
		res = h._heap[0];

	return res;
};

MinPriorityQueue.prototype.dequeue = function() {
	/**
	* extracts the min value from the PQ while keeping the underlying
	* heap consistent
	*/
	var res = Infinity;
	var h = this._heap;
	var s = h._heapSize;

	if (h._heapSize > 0) {
		res = h._heap[0];
		h._heap[0] = h._heap[h._heapSize-1];
		h._heapSize--;
		this._minHeapify(0);
	}

	return res;
};

MinPriorityQueue.prototype._decreaseKey = function(index, pri) {
	/**
	* decrease the value (key) of some element in the queue. Forward the 
	* change on the underlying heap, for consistency purposes
	*/
	var h = this._heap;

	if (index < h._heapSize && pri < h._heap[index]._pri) {
		var cur = index;
		var parent = Math.floor((cur - 1) / 2);

		h._heap[index]._pri = pri;
		while (cur > 0 && h._heap[parent]._pri > h._heap[cur]._pri) {
			var temp = h._heap[parent];

			h._heap[parent] = h._heap[cur];
			h._heap[cur] = temp;
			cur = parent;
			parent = Math.floor((cur - 1) / 2);
		}
	}
};

MinPriorityQueue.prototype.enqueue = function (pri, value) {
	var h = this._heap;

	h._heapSize++;
	h._heap[h._heapSize-1] = new HeapNode(Infinity, value);
	this._decreaseKey(h._heapSize-1, pri);
};

MinPriorityQueue.prototype._minHeapify = function (i) {
	/**
	* the i-th element in the heap violates the min-heap property
	* - check the largest element between (i, left(i), right(i))
	* - enforce the property given the largest
	* - recursively enforce the property (sink)
	*/
	var smallest = i;
	var l = 2 * i + 1;
	var r = 2 * i + 2;
	var a = this._heap._heap;

	if (l < this._heap._heapSize && a[l]._pri < a[smallest]._pri)
		smallest = l;
	if (r < this._heap._heapSize && a[r]._pri < a[smallest]._pri)
		smallest = r;
	if (smallest != i) {
		var temp = a[i];

		a[i] = a[smallest];
		a[smallest] = temp;
		this._minHeapify(smallest);
	}
};

MinPriorityQueue.prototype._buildMinHeap = function(a) {
	/**
	* build a min heap via the min-heapify procedure
	*/
	var m = Math.floor((a.length - 1 ) / 2);

	this._heap = new Heap(a, a.length);
	for (var i = m; i >= 0; i--)
		this._minHeapify(i);
}

exports.MinPriorityQueue = MinPriorityQueue;

return exports;

})(jQuery);

ACTIVETIMESHEETS.engine  = (function ($) { /* begin module */
/**
* DOM API
* Timegraph Model
* Timesheets parser
* PresentationWrapper (public API)
*/
"use strict";

/* global variables for presentation control */
var exports = {};
var presentation = null;
// var node_id_idx = null;
var flags = null;
var logger = null;
var formatter = new ACTIVETIMESHEETS.util.TimegraphFormatter();

function reset() {
	/**
	* reset the state of the engine
	*/
	// presentation = null; // wrapper for the timegraph
	// node_id_idx = {};
	flags = {
		stalled_media_items: 0, 
		unresolved_timed_media: 0, 
		timed_media: [] // keeps track of timed media in the presentation
	};
	// unbind global events
	$(document).unbind('media_stalled media_canplay implicit_duration_updated timing_resolved');
}

function bindEvents() {
	// control block/unblock of media items
	$(document).bind('media_stalled', function () {
		if (flags.stalled_media_items > 0) {
			logger.debug('buffering ongoing...');
			$(document).trigger('smil_stalled');
		}
	});
	$(document).bind('media_canplay', function () {
		if (flags.stalled_media_items == 0) {
			logger.debug('buffering finished');
			$(document).trigger('smil_canplay');
		}
	});
	$(document).bind('implicit_duration_updated', function (ev, data) {
		var affected_node = data['affected'];

		logger.debug('implicit duration updated on', affected_node, 
			affected_node._node_id, presentation.formatTimegraph());
	});
	$(document).bind('timing_resolved', function (ev, params) {
		logger.debug('attribute %4 on node %3 resolved by event %1 issued by node %2'
			.replace('%1', params['ev_name'])
			.replace('%2', params['pub_node_id'])
			.replace('%3', params['sub_node_id'])
			.replace('%4', params['attr_name']));
		logger.debug('timing resolved', presentation.formatTimegraph());
	});
	$(document).bind('timegraph_edited', function (ev, data) {
		var affected = data['affected']
		var root = affected;

		while (root._parent !== null)
			root = root._parent;
		logger.debug('timegraph edited affecting node(s):', affected, 
			affected._node_id);
		logger.debug('timegraph edited', formatter.toHierarchyStr(root, true));
	});
	$(document).bind('link_activated', function (ev, data) {
		var target = data['target'];

		logger.debug('link activated', presentation.formatTimegraph(true))
	});
	$('body').delegate('a', 'click.timesheets', function (ev) {
		/**
		* watch all anchors for media fragments
		* - temporally disables hash change to avoid duplicate link activation
		*/
		var base_uri = this.baseURI;
		var doc_uri = this.origin + this.pathname; // without hash

		if (window.location.hash != this.hash) {
			// a hashchange will be triggered next, inhibit it
			$(window).data('inhibit_hashchange', true);
		}
		if (base_uri == doc_uri) 
			// process only internal fragments
			enforceMediaFragments(this.href);
	});
	$(window).bind('hashchange.timesheets', function () {
		// watch for media fragments
		if (!$(this).data('inhibit_hashchange')) {
			enforceMediaFragments(window.location.href);
		} else {
			$(this).removeData('inhibit_hashchange');
		}
	});
	$(ACTIVETIMESHEETS.engine).bind('presentation_ready', function () {
		// TODO: parse media fragments and adapt the presentation accordingly;
		enforceMediaFragments(window.location.href);
	});
}

function enforceMediaFragments(href) {
	/**
	* apply media fragments to the SMIL document
	* relevant dimensions:
	* - fragment identifier: a HTML DOM element (e.g. #img1)
	* - named dimension: a SMIL DOM element (e.g. id=video1)
	* - track_dimension: yet to define
	* - time_dimension: a seek to the interval
	* 
	* TODO: check  how the dimensions can be combined, so far they are applied 
	* exclusively
	*/
	var media_frags = MediaFragments.parse(href);

	if (Object.keys(media_frags.hash).length > 0) {
		var frag_ids = media_frags.hash.frag_id;
		var named_dim = media_frags.hash.id;
		var track_dim = media_frags.hash.track;
		var time_dim = media_frags.hash.t;
		var has_named_dim = named_dim !== undefined && named_dim.length > 0;
		var has_frag_dim = frag_ids !== undefined && frag_ids.length > 0;
		var has_time_dim = time_dim !== undefined && time_dim.length > 0;
		var has_track_dim = track_dim !== undefined && track_dim.length > 0;
		var enforce_time_dim = function (node) {
			/**
			* seeks the node to the beggining moment of the supplied
			* interval
			*/
			var offset = time_dim[0]['startNormalized'];

			node.linkActivate(offset);
		};

		if (has_frag_dim) {
			/*
			* fragment identifiers (i.e. HTML DOM elements)
			* (this is the only dimension supported by SMIL)
			*/
			var node = $('#' + frag_ids[0]);

			if (node.length > 0) {
				var tg_node = $(node).data('timegraph_node');

				if (tg_node !== undefined) {
					// a fragment identifier can be (optionally) combined with 
					// a time identifier
					if (has_time_dim)
						// activate to the supplied time
						enforce_time_dim(tg_node);
					else
						// activate in the beginning
						tg_node.linkActivate();
				}
			}
		}
		else if (has_named_dim) {
			/**
			* named dimension (i.e. SMIL DOM elements)
			* TODO: collect all timegraph identifiers
			*/
			// check the id exists in the timegraph
			// if found, perform a seek in the element
			var id = named_dim[0]['name'];
			var node = presentation._timegraph.find(id);

			if (node !== null) {
				// a named node can also be combined with time
				if (has_time_dim)
					// seek to the provided time
					enforce_time_dim(node);
				else
					// seek to the beginning
					node.linkActivate();
				if (node._target_node !== null) {
					// visual scroll if a target is associated unless scroll
					// is inhibited for the target
					var scroll = $(node._target_node).data('scroll') || false;

					if (scroll) {
						var offset = $(node._target_node).offset();

						window.scrollTo(offset.left, offset.top);
					}
				}
			}
		}
		else if (has_track_dim) {
			/*
			* TODO: define intended semantics
			*/
		}
		else if (has_time_dim) {
			/**
			* seeks the document to the beggining moment of the supplied
			* interval
			*/
			enforce_time_dim(presentation._timegraph);
		}
		// TODO: define the semantics of combining the dimensions
	}
}

function TimedLogger(_logger) {
	/**
	* a wrapper for a logger including timing of the messages
	* if no _logger is provided, generate a logger from scratch
	*/
	this.timer = new Timer();
	this._logger = _logger || null;

	if (this._logger !== null)
		this.mode = this._logger.mode; // debug | info | error | warn
	else
		this.mode = 'info'; 

	function prepare_args(args) {
		var message_array = [];
		for (var i = 0; i < args.length; i++) {
			var str = '';
			if (typeof(args[i]) == 'object')
				str = parse_class_name(args[i].constructor.toString());
			else
				str = args[i];
			message_array.push(str);
		}

		return message_array.join(' ');
	}

	function parse_class_name(name) {
		var c_name = name.match(/function\s*((?:\w|\d)+)/);

		if (c_name && c_name.length && c_name.length > 1)
			return c_name[1];
		else
			return '';
	}

	function extend_args(new_arg, arg_list) {
		var args = [];

		args.push(new_arg);
		for (var i = 0; i < arg_list.length; i++)
			args.push(arg_list[i]);

		return args;
	}

	this.setMode = function (_mode) {
		this.mode = _mode;
	};
	
	// constructor
	if (this._logger == null && console !== null) {
		// redefine the methods in the absence of a wrapped logger
		this.debug = function () {
			if (this.mode == 'debug')
				console.debug("DEBUG (%s): ".replace('%s', this.timer.getTime()) 
					+ prepare_args(arguments));
		};

		this.error = function () {
			if (this.mode == 'error' || this.mode == 'debug')
				console.error("ERROR (%s): ".replace('%s', this.timer.getTime()) 
					+ prepare_args(arguments));
		};

		this.warn = function () {
			if (this.mode == 'warn' || this.mode == 'debug')
				console.warn("WARN (%s): ".replace('%s', this.timer.getTime()) 
					+ prepare_args(arguments));
		};

		this.info = function () {
			if (this.mode == 'info' || this.mode == 'debug')
				console.info("INFO (%s): ".replace('%s', this.timer.getTime()) 
					+ prepare_args(arguments));
		};
	} else if (this._logger !== null) {
		// delegate the messages to the wrapped logger
		this.debug = function () {
			this._logger.enableCache();
			this._logger.debug.apply(this._logger,
				extend_args('(%s):'.replace('%s', this.timer.getTime()), 
				arguments));
			this._logger.disableCache();
		};

		this.error = function () {
			this._logger.enableCache();
			this._logger.error.apply(this._logger,
				extend_args('(%s):'.replace('%s', this.timer.getTime()), 
				arguments));
			this._logger.disableCache();
		};

		this.warn = function () {
			this._logger.enableCache();
			this._logger.warn.apply(this._logger,
				extend_args('(%s):'.replace('%s', this.timer.getTime()), 
				arguments));
			this._logger.disableCache();
		};

		this.info = function () {
			this._logger.enableCache();
			this._logger.info.apply(this._logger,
				extend_args('(%s):'.replace('%s', this.timer.getTime()), 
				arguments));
			this._logger.disableCache();
		};
	}
	else if (console == null) {
		// no console logging is possible
		this.debug = function () {};
		this.error = function () {};
		this.warn = function () {};
		this.info = function () {};
	}
}

/**
* ActiveTimesheets DOM API: 
* - manipulate the DOM
* - create timegraph nodes
* - update timing accordingly
*/

function TimesheetDocument(__doc_node, __parser) {
	/**
	* a wrapper for a timesheet document
	*/
	this._doc_node = __doc_node;
	this._parser = __parser;
}

TimesheetDocument.prototype.getTimesheetElement = function () {
	return new TimesheetElement($(this._doc_node).children().first().get(0), this._parser);
};

TimesheetDocument.prototype.createElement = function (name, attrs) {
	/*
	* create a new node
	*/
	var node = this._doc_node.createElement(name);
	var element = null;
	var tg_node = null;
	
	for (var k in attrs)
		$(node).attr(k, attrs[k]);
	if (/timesheet/i.test(name)) {
		element = new TimesheetElement(node, this._parser);
		this._parser.timesheet(node);
	} else if (/par|seq|excl/i.test(name)) {
		element = new TimeContainerElement(node, this._parser);
		this._parser.timeElement(node);
	} else if (/item/i.test(name)) {
		element = new TimeItemElement(node, this._parser);
		this._parser.timeElement(node);
	} else if (/area/i.test(name)) {
		element = new AreaLinkElement(node, this._parser);
		this._parser.timeElement(node);
	} else
		element = new TimeElementElement(node, this._parser);
	tg_node = element.getTimegraphNode();
	if (tg_node !== null && tg_node !== undefined)
		tg_node.computeTiming();
	if (attrs !== undefined && 'volume' in attrs)
		tg_node.updateFormatting();
	
	return element;
};

TimesheetDocument.prototype.getElementByTargetId = function (_id) {
	/**
	* return a list of SMIL DOM nodes which have as target node
	* the HTML element indentified by _id
	*/
	var ts_element = this.getTimesheetElement();
	// TODO: complete this method
};

function TimeElementElement(__dom_node, __parser) {
	/*
	* generic wrapper for a timesheet dom element
	*/
	this._dom_node = __dom_node;
	this._parser = __parser;
}

TimeElementElement.prototype._wrapNodes = function (nodes) {
	var res = [];

	for (var i = 0; i < nodes.length; i++) {
		var node = nodes[i];
		var wrapped = null;

		if (/par|seq|excl/i.test(node.nodeName))
			wrapped = new TimeContainerElement(node, this._parser);
		else if (/item/i.test(node.nodeName))
			wrapped = new TimeItemElement(node, this._parser)
		else if (/area/i.test(node.nodeName))
			wrapped = new AreaLinkElement(node, this._parser);
		else if (/timesheet/i.test(node.nodeName))
			wrapped = new TimesheetElement(node, this._parser);

		res.push(wrapped);
	}

	return res;
};

TimeElementElement.prototype._wrapParent = function () {
	var parent = $(this._dom_node).parent().get(0);
	var res = null;

	if (/timesheet/i.test(parent.nodeName))
		res = new TimesheetElement(parent, this._parser);
	else if (/par|seq|excl/i.test(parent.nodeName))
		res = new TimeContainerElement(parent, this._parser);
	else if (/item/i.test(parent.nodeName))
		res = new TimeItemElement(parent, this._parser);

	return res;
};

TimeElementElement.prototype.getParent = function () {
	return this._wrapParent();
};

TimeElementElement.prototype.getAttr = function (name, value) {
	return $(this._dom_node).attr(name);
};

TimeElementElement.prototype.getTimegraphNode = function () {
	return $(this._dom_node).data('timegraph_node');
};

TimeElementElement.prototype.remove = function () {
	/*
	* remove the node from the dom and timegraph
	* @return the immediate modified parent 
	*/
	var tg_node = this.getTimegraphNode();
	var tg_parent = tg_node._parent;
	var dom_parent = $(this._dom_node).parent().get(0);

	if (this._dom_node !== null) {
		$(this._dom_node).remove();
		this._dom_node = null;
		tg_parent.removeChild(tg_node);
		tg_parent.updateTiming();
		$(document).trigger('timegraph_edited', {'affected': tg_parent});
	}

	return this._wrapNodes([dom_parent]);
};

TimeElementElement.prototype.before = function (element) {
	/**
	* insert the element before this element
	* @element an instance of TimeElementElement
	* @return the immediate modified parent
	*/
	var this_tg_node = this.getTimegraphNode();
	var elem_tg_node = element.getTimegraphNode();
	var dom_parent = $(this._dom_node).parent();

	$(this._dom_node).before(element._dom_node);
	if (this_tg_node !== null && elem_tg_node !== null) {
		var tg_parent = this_tg_node._parent;

		tg_parent.addChildBefore(elem_tg_node, this_tg_node);
		tg_parent.updateTiming(elem_tg_node);
		$(document).trigger('timegraph_edited', {'affected': elem_tg_node});
	}

	return this._wrapParent();
};

TimeElementElement.prototype.after = function (element) {
	/**
	* insert the element after this element
	* @element an instance of TimeElementElement
	* @return the immediate modified parent
	*/
	var this_tg_node = this.getTimegraphNode();
	var elem_tg_node = element.getTimegraphNode();

	$(this._dom_node).before(element._dom_node);
	if (this_tg_node !== null && elem_tg_node !== null) {
		var parent = this_tg_node._parent;

		parent.addChildAfter(elem_tg_node, this_tg_node);
		parent.updateTiming(elem_tg_node);
		$(document).trigger('timegraph_edited', {'affected': elem_tg_node});
	}

	return this._wrapParent();
};

TimeElementElement.prototype.detach = function (element) {
	/**
	* detach the element from the dom and timegraph
	* @element an instance of TimeElementElement
	* @return the immediate modified parent
	*/
	var dom_parent = $(this._dom_node).parent().get(0);
	var dom_node = $(this._dom_node).detach();
	var tg_node = this.getTimegraphNode();
	var tg_parent = tg_node._parent;

	tg_parent.removeChild(tg_node);
	tg_parent.updateTiming();
	$(document).trigger('timegraph_edited', {'affected': tg_node});

	return this._wrapNodes([dom_parent]);
};

function TimeContainerElement(__dom_node, __parser) {
	TimeElementElement.call(this, __dom_node, __parser);
}

ACTIVETIMESHEETS.util.inherits(TimeElementElement, TimeContainerElement);

TimeContainerElement.prototype.getChildren = function () {
	/*
	* wrap the child dom nodes
	* @return a list of wrapper children
	*/
	return this._wrapNodes($(this._dom_node).children());
};

TimeContainerElement.prototype.first = function () {
	var dom_first = $(this._dom_node).children().first();
	var wrap_first = null;

	if (dom_first.length > 0) {
		wrap_first = this._wrapNodes([dom_first.get(0)])[0];
	}

	return wrap_first;
};

TimeContainerElement.prototype.last = function () {
	var dom_last = $(this._dom_node).children().last();
	var wrap_last = null;

	if (dom_last.length > 0)
		wrap_last = this._wrapNodes([dom_last])[0];

	return wrap_last;
};

TimeContainerElement.prototype.find = function (expr) {
	return this._wrapNodes($(this._dom_node).find(expr));
};

TimeContainerElement.prototype.append = function (element) { 
	/*
	* @element a TimeElementElement wrapper
	* @return self after operation
	* 
	* append the element to the container and recompute the timing;
	* attributes are reparsed to enforce context-specific constraints
	*/
	$(this._dom_node).append(element._dom_node); // dom insert
 
	if (element._dom_node !== null && /par|seq|item|area/i.test(element._dom_node.nodeName)) {
		var p_t_node = this.getTimegraphNode();
		var c_t_node = element.getTimegraphNode();

		// timegraph insert and update
		if (c_t_node !== null) {
			p_t_node.appendChild(c_t_node);
			c_t_node.setAttributes(
				this._parser.parseAttributes(element._dom_node));
			c_t_node.computeTiming();
			p_t_node.updateTiming(c_t_node);
			$(document).trigger('timegraph_edited', {'affected': c_t_node});
		}
	}

	return this;
};

TimeContainerElement.prototype.appendChildren = function (elements) {
	/**
	* @elements a list of elements to be appended
	* @return self after operation
	* 
	* append multiple elements to the container and compute the timing 
	* after finishing it
	*/
	var affected_els = [];
	var p_t_node = this.getTimegraphNode();

	for (var i = 0; i < elements.length; i++) {
		var element = elements[i];
		var recomp = false;

		$(this._dom_node).append(element._dom_node);
		if (element._dom_node !== null && /par|seq|item|area/i.test(
			element._dom_node.nodeName)) {
			var c_t_node = element.getTimegraphNode();

			// timegraph insert
			if (c_t_node !== null) {
				p_t_node.appendChild(c_t_node);
				c_t_node.setAttributes(this._parser.parseAttributes(
					element._dom_node));
				c_t_node.computeTiming();
				affected_els.push(c_t_node);
				recomp = true;
			}
		}
	}
	if (recomp) {
		// timegraph update
		p_t_node.updateTiming();
		$(document).trigger('timegraph_edited', {'affected': p_t_node})
	}
};

TimeContainerElement.prototype.removeChildren = function (elements) {
	/**
	* remove a list a children from this container, triggering a single
	* timing recomputation
	* 
	* @elements a list of child elements to be removed
	* @return self after operation
	*/
	var p_t_node = this.getTimegraphNode();

	for (var i = 0; i < elements.length; i++) {
		var element = elements[i];
		var recomp = false;

		if (element._dom_node !== null && /par|seq|item|area/i.test(
			element._dom_node.nodeName)) {
			p_t_node.removeChild(element.getTimegraphNode());
			recomp = true;
		}
		$(element._dom_node).remove();
	}
	if (recomp) {
		// timegraph update
		p_t_node.updateTiming();
		$(document).trigger('timegraph_edited', {'affected': p_t_node});
	}

};

TimeContainerElement.prototype.setAttr = function (name, value) {
	$(this._dom_node).attr(name, value);

	if (/begin|end|dur|clipbegin|clipend|clip-begin|clip-end|speed|volume/i.test(name)) {
		var tg_node = this.getTimegraphNode();

		tg_node.setAttribute(this._parser.parseAttribute(name, value, 
			this._dom_node));
		if (/volume/i.test(name))
			tg_node.updateFormatting();
		else
			tg_node.updateTiming();
		$(document).trigger('timegraph_edited', {'affected': tg_node});
	} 

	return this;
};

TimeContainerElement.prototype.setAttrs = function (attrs) {
	/**
	* set multiple attributes on the element but triggers a single timegraph 
	* update
	*/
	var tg_node = this.getTimegraphNode();
	var update_timing = false;
	var update_formatting = false;

	for (var name in attrs) {
		var value = attrs[name];

		$(this._dom_node).attr(name, value);
		if (/begin|end|dur|speed|volume/i.test(name)) {
			tg_node.setAttribute(this._parser.parseAttribute(name, value, 
				this._dom_node));
			if (/volume/i.test(name))
				update_formatting = true;
			else
				update_timing = true;
		}

	}
	if (update_timing) {
		tg_node.updateTiming();
		$(document).trigger('timegraph_edited', {'affected': tg_node});
	}
	if (update_formatting)
		tg_node.updateFormatting();
};

TimeContainerElement.prototype.removeAttr = function (name) {
	if ($(this._dom_node).attr(name) !== undefined) {
		var tg = this.getTimegraphNode();
		var iname = this._parser.getInternalAttrName(name);

		$(this._dom_node).removeAttr(name);
		tg.removeAttribute(iname);
		if (/volume/i.test(name))
			tg.updateFormatting();
		else if (/begin|end|dur|speed/)
			tg.updateTiming();
		$(document).trigger('timegraph_edited', {'affected': tg});
	}
};

TimeContainerElement.prototype.replaceChild = function (old_child, new_child) {
	var res = null;

	if (old_child.getParent()._dom_node === this._dom_node) {
		var tg_parent = this.getTimegraphNode();
		var status = null;

		// replace the dom node
		status = this._dom_node.replaceChild(new_child._dom_node, old_child._dom_node);
		if (status === old_child._dom_node) {
			// replace timegraph node
			status = tg_parent.replaceChild(old_child.getTimegraphNode(), new_child.getTimegraphNode());
			if (status === old_child.getTimegraphNode()) {
				tg_parent.updateTiming();

				$(document).trigger('timegraph_edited', {'affected': tg_parent});
			}
			res = old_child;
		}
	}

	return res;
};

function TimesheetElement(__dom_node, __parser) {
	/**
	* a timesheet element has the same semantics of par time containers, 
	* except for the attributes
	*/
	TimeContainerElement.call(this, __dom_node, __parser);
}

ACTIVETIMESHEETS.util.inherits(TimeContainerElement, TimesheetElement);

TimesheetElement.prototype.setAttr = function (name, value) {
	/**
	* TODO: currently, the speed attr is constrained to the root timesheet
	* element; in a later moment, we should adapt the code to apply 
	* the attr to any element, as per the strategy already documented
	* in the blog
	*/
	$(this._dom_node).attr(name, value);

	if (/speed|volume/i.test(name)) {
		var tg_node = this.getTimegraphNode();

		if (tg_node._parent === null) {
			tg_node.setAttribute(this._parser.parseAttribute(name, value, 
			this._dom_node));
			if (/volume/i.test(name))
				tg.updateFormatting();
			else
				tg_node.updateTiming();
			$(document).trigger('timegraph_edited', {'affected': tg_node});
		}
	}

	return this;
};

TimesheetElement.prototype.removeAttr = function (name) {
	if ($(this._dom_node).attr(name) !== undefined) {
		var tg = this.getTimegraphNode();
		var iname = this._parser.getInternalAttrName(name);

		$(this._dom_node).removeAttr(name);
		tg.removeAttribute(iname);
		if (/volume/i.test(name))
			tg.updateFormatting();
		else if (/speed/i.test(name))
			tg.updateTiming();
		$(document).trigger('timegraph_edited', {'affected': tg});
	}
};

function TimeItemElement(__dom_node, __parser) {
	/**
	* a time element can be a single item or a time container: 
	* - a seq container, depending on how many items the 'select' expr yields;
	* - a par container, depending on the presence of nested elements
	* bottom line is that it inherits from time container
	*/
	TimeContainerElement.call(this, __dom_node, __parser);
}

ACTIVETIMESHEETS.util.inherits(TimeContainerElement, TimeItemElement);

TimeItemElement.prototype.setAttr = function (name, value) {
	$(this._dom_node).attr(name, value);

	if (/begin|dur|end|clipbegin|clipend|clip-begin|clip-end|speed|volume/i.test(name)) {
		TimeItemElement._superClass.setAttr.call(this, name, value);
	} else if (/select/i.test(name)) {
		// 'select' can lead to deep implications in the time element -- reparse
		var old_tg_node = this.getTimegraphNode();
		var new_tg_node = this._parser.timeElement(this._dom_node);
		var parent = old_tg_node._parent;

		parent.addChildAfter(new_tg_node, old_tg_node);
		parent.removeChild(old_tg_node);
		new_tg_node.updateTiming();
		$(document).trigger('timegraph_edited', {'affected': new_tg_node});
	}

	return this;
};

function AreaLinkElement(__dom_node, __parser) {
	TimeElementElement.call(this, __dom_node, __parser);
}

ACTIVETIMESHEETS.util.inherits(TimeElementElement, AreaLinkElement);

AreaLinkElement.prototype.setAttr = function (name, value) {
	$(this._dom_node).attr(name, value);

	if ((/begin|end|dur/i).test(name)) {
		var tg_node = this.getTimegraphNode();

		tg_node.setAttribute(this._parser.parseAttribute(name, value, 
			this._dom_node));
		tg_node.updateTiming();
		$(document).trigger('timegraph_edited', {'affected': tg_node});
	}

	return this;
};

AreaLinkElement.prototype.removeAttr = function (name) {
	if ($(this._dom_node).attr(name) !== undefined) {
		var tg = this.getTimegraphNode();
		var iname = this._parser.getInternalAttrName(name);

		$(this._dom_node).removeAttr(name);
		tg.removeAttribute(iname);
		if (/begin|end/i.test(name))
			tg.updateTiming();
		$(document).trigger('timegraph_edited', {'affected': tg});
	}
};

AreaLinkElement.prototype.setAttrs = function (attrs) {
	/**
	* set multiple attributes on the element but triggers a single timegraph 
	* update
	*/
	var tg_node = this.getTimegraphNode();
	var update = false;

	for (var name in attrs) {
		var value = attrs[name];

		$(this._dom_node).attr(name, value);
		if ((/begin|end|dur/i).test(name)) {
			tg_node.setAttribute(this._parser.parseAttribute(name, value, 
			this._dom_node));
			update = true;
		}
	}
	if (update) {
		tg_node.updateTiming();
		$(document).trigger('timegraph_edited', {'affected': tg_node});
	}
};

/***
* SMIL Timesheets parsing and timegraph construction
*/

function Parser() {
	/**
	* Parses the various types of timesheets (external, internal and inline),
	* merge their representation and build the resulting time graph
	*/
	var id_generator = 0;
	var expr_stack = [];
	var self = this;
	var parser = this;

	function parseNumericValue(v) {
		var value = parseFloat(v);

		if (isNaN(value))
			value = Infinity;
		else if (value < 0)
			value = 0;

		return value;
	}

	function toSeconds(value, unit) {
		var result = null;

		if (unit == 'ms')
			result = value / 1000;
		else if (unit == 'min')
			result = value * 60;
		else if (unit == 'h')
			result = value * 3600;
		else // assume seconds as a unit by default
			result = value;

		return result;
	}

	function parseTimeOrEvent(time_i, dom_node, events_allowed) {
		/*
		 * parses lists of the various time formats allowed in the syntax
		 */
		var result = {};
		var parse_events = events_allowed ? true : false;

		// parse the time units to seconds or to event components
		if (time_i == 'indefinite') {
			result.type = 'indefinite';
			result.value = Infinity;
		} else if (/^([-+]?(?:[0-9]*\.)?[0-9]+)\s*(ms|s|min|h)?$/.test(time_i)) {
			// time count values
			var matches = /([-+]?(?:[0-9]*\.)?[0-9]+)\s*(ms|s|min|h)?/.exec(time_i);
			var value = parseNumericValue(matches[1]);
			var unit = matches[2];

			result.type = 'time';
			result.value = toSeconds(value, unit);
		} else if (/^(\d+):([0-5]?[0-9]):([0-5]?[0-9])$/.test(time_i)) {
			// full clock values
			var matches = /^(\d+):([0-5]?[0-9]):([0-5]?[0-9])$/.exec(time_i);
			var hours = parseNumericValue(matches[1]);
			var minutes = parseNumericValue(matches[2]);
			var seconds = parseNumericValue(matches[3]);

			result.type = 'time';
			result.value = hours * 3600 + minutes * 60 + seconds;
		} else if (/^([0-5]?[0-9]):([0-5]?[0-9])$/.test(time_i)) {
			// partial clock values
			var matches = /^([0-5]?[0-9]):([0-5]?[0-9])$/.exec(time_i);
			var minutes = parseNumericValue(matches[1]);
			var seconds = parseNumericValue(matches[2]);

			result.type = 'time';
			result.value = minutes * 60 + seconds;
		} else if (/^((?:\w|\d)+)\.((?:\w|\d)+)\s*(?:[+]?\s*([0-9]+)\s*(ms|s|min|h)?)?$/.test(time_i) && parse_events) {
			/**
			* parse events
			* - only positive deltas are allowed
			*/
			var matches = /^((?:\w|\d)+)\.((?:\w|\d)+)\s*(?:[+]?\s*([0-9]+)\s*(ms|s|min|h)?)?$/.exec(time_i);
			var target_id = matches[1];
			var ev_name = matches[2];
			var delta_value = parseInt(matches[3]);
			var delta_unit = matches[4];
			
			if (ev_name == 'begin' ||
					ev_name == 'end' || ev_name == 'click' || 
					ev_name == 'activate') {
				var delta_seconds = 0;

				if (delta_value && !isNaN(delta_value))
					delta_seconds = toSeconds(delta_value, delta_unit);
				result['type'] = 'event';
				result['status'] = 'unresolved';
				result['value'] = Infinity;
				result['target_id'] = target_id;
				result['dom'] = dom_node;
				result['event'] = ev_name;
				result['delta'] = delta_seconds;
			}
		} else {
			// fallback for empty/invalid attributes
			result['type'] = 'time';
			result['value'] = 0;
		}

		return result;
	}

	function getInternalAttrName(name) {
		/**
		* return the internal key used for a specific attribute
		*/
		if (name == 'clipbegin')
			return 'clip-begin';
		else if (name == 'clipend')
			return 'clip-end';
		else
			return name;
	}

	function parseAttribute(_name, _value, dom_node) {
		var result = {};
		var parsed = null;
		var name = String(_name).toLowerCase();
		var	value = String(_value).replace(/^\s+|\s+$/g, '').toLowerCase();

		if (name == 'repeatcount') {
			// TODO: repeat semantics
		} else if (name == 'repeatdur') {
			// TODO: repeat semantics
		} else if (name == 'begininc') {
			// TODO: beginInc semantics
		} else if (name == 'dur') {
			result['dur'] = parseTimeOrEvent(value, dom_node, false);
		} else if (name == 'begin') {
			var events_allowed = true;

			if ($(dom_node).data('parent') !== undefined && 
				$(dom_node).data('parent').getType() == 'seq')
				// children of seq cannot have indefinite begin time
				events_allowed = false;
			result['begin'] = parseTimeOrEvent(value, dom_node, events_allowed);
		} else if (name == 'end') {
			result['end'] = parseTimeOrEvent(value, dom_node, true);
		} else if (name == 'endsync') {
			result['endsync'] = {
				'value': value, 
				'dom': dom_node
			};
		} else if (name == 'speed') {
			var parsed = parseNumericValue(value);

			if (parsed < Infinity)
				result['speed'] = parsed;
			else
				result['speed'] = 1.0;
		} else if (name == 'fill') {
			// freeze is the only fill value allowed
			result['fill'] = 'freeze';
		} else if (name == 'id') {
			result['id'] = value;
		} else if (name == 'clipbegin' || name == 'clip-begin') {
			result['clip-begin'] = parseTimeOrEvent(value, dom_node, false);
		} else if (name == 'clipend' || name == 'clip-end') {
			result['clip-end'] = parseTimeOrEvent(value, dom_node, false);
		} else if (name == 'href') {
			if (value !== '')
				result['href'] = value;
		} else if (name == 'actuate') {
			if (/onload/i.test(value))
				result['actuate'] = true;
			else 
				result['actuate'] = false;
		} else if (name == 'target') {
			if (/_blank|_self|_parent|_top/i.test(value))
				result['target'] = value;
		} else if (name == 'sourceplaystate') {
			if (/pause|play|stop/i.test(value))
				result['sourceplaystate'] = value;
		} else if (name == 'targetplaystate') {
			if (/pause|play/i.test(value))
				result['destinationplaystate'] = value;
		} else if (name == 'volume') {
			var parsed = parseNumericValue(value);

			if (parsed >= 0 && parsed <= 1.0)
				result['volume'] = parsed;
			else
				result['volume'] = 1.0;
		}

		return result;
	};

	function parseAttributes(dom_node) {
		/**
		* parse timing attributes (common to all time elements)
		* TODO: adapt the attribute detection to encompass inline markup
		*/
		var attrs = (dom_node) ? dom_node.attributes : [];
		var result = {};

		for (var i = 0; i < attrs.length; i++) {
			var res = parseAttribute(attrs[i].name, attrs[i].value, dom_node);

			for (var k in res)
				result[k] = res[k];
		}

		return result;
	}

	function timesheet(tsheet_node) {
		/*
		* TIMESHEET := '<timesheet>' TIMEELEMENT* '</timesheet>'
		* attributes: src, timing attributes
		*
		* all the children of a timesheet are combined using a par container
		* i.e. transfering here the XHTML+SMIL behavior as recommended
		* by the smil structure module:
		* http://www.w3.org/TR/smil/smil-structure.html
		*/
		return timeContainer(tsheet_node);
	}

	function timeElement(element_node) {
		/**
		* TIMEELEMENT := TIMECONTAINER | TIMEITEM
		* 
		* TODO: add a separate parsing step for area links
		*/
		var element = null;
		var name = element_node.nodeName;

		if (/seq|par|excl/i.test(name)) {
			element = timeContainer(element_node);
			element.setAttributes(parseAttributes(element_node));
		} else if (/item/i.test(name))
			element = timeItem(element_node);
		else if (/area/i.test(name))
			element = areaLink(element_node);
		else if (/timesheet/i.test(name))
			element = timesheet(element_node);

		return element;
	}

	function timeContainer(c_node) {
		/*
		* TIMECONTAINER := '<par>'|'<seq>'|'<excl>' TIMEELEMENT* '<par>'|'<seq>'|'<excl>
		*/
		var name = c_node.nodeName;
		var children = $(c_node).children();
		var container = null;
		var node_id = id_generator++;

		// parse structure
		if (/seq/i.test(name)) {
			container = new TimeContainerSeq(node_id);
		} else if (/par|timesheet/i.test(name)) {
			container = new TimeContainerPar(node_id);
		} else if (/excl/i.test(name)) {
			container = new TimeContainerExcl(node_id);
		}
		if (container !== null) {
			var c_elements = [];
			var a_elements = [];

			for (var i = 0; i < children.length; i++) {
				var child = children[i];
				var child_element = null;

				$(child).data('parent', container);
				child_element = timeElement(child);
				if (child_element !== null && child_element.getType() != 'area')
					c_elements.push(child_element);
				else if (child_element !== null && child_element.getType() == 'area')
					a_elements.push(child_element);
				$(child).removeData('parent');
			}
			container.setChildren(c_elements);
			container.setLinks(a_elements);
			container.setAttributes(parseAttributes(c_node));
			$(c_node).data('timegraph_node', container);
		}

		return container;
	}

	function timeItem(element) {
		/**
		* TIMEITEM := <item select=' CSSSELECTOR '>' TIMELEMENT* '</item>'
		* 
		* build a composite timegraph nodes for a time item
		* Cases: 
		* 1. single target and no nested node: target node
		* 2. no target and no nested node: null
		* 3. a single target and multiple nested nodes: par with all nodes
		* 4. multiple targets and multiple nested nodes: seq with multiple par
		*/
		var target_expr = $(element).attr('select');
		var target_nodes = null;
		var children = $(element).children();
		var time_item = null;
		var target_elements = [];
		
		// retrieve target nodes
		if (expr_stack.length > 0) {
			var expr = expr_stack[expr_stack.length - 1];

			target_nodes = $(expr).find(target_expr).toArray();
		} else
			target_nodes = $(target_expr).toArray();
		// parse target nodes
		for (var i = 0; i < target_nodes.length; i++) {
			var target_node = target_nodes[i];
			var target_element = null;
			var wrapper_element = null;

			if (/video|audio/i.test(target_node.nodeName)) {
				// parse a continuous media element
				target_element = new HTMLContinuousMediaElement(id_generator++, 
					target_node);
			} else if (/iframe/i.test(target_node.nodeName) && 
				$(target_node).attr('data-mediaelement') == 'youtube') {
				// parse a youtube media element
				target_element = new YouTubeMediaElement(id_generator++, 
					target_node, $(target_node).data('yt_player'));
			} else
				// parse a discrete media element
				target_element = new DiscreteMediaElement(id_generator++, target_node);
			if (target_element !== null) {
				var nested_elements = [];

				target_element.setAttributes(parseAttributes(element));
				// parse nested elements (all relative to the current target)
				// TODO: make the expression be evaluated relatively
				for (var j = 0; j < children.length; j++) {
					var child = children[j];
					var child_element = null;

					if (child.nodeName == 'area') {
						// links apply directly to each target
						var link = areaLink(child);

						target_element.addLink(link);
					} else {
						expr_stack.push(target_node);
						child_element = timeElement(child);
						if (child_element !== null) {
							nested_elements.push(child_element);
						}
						expr_stack.pop();
					}
				}
				if (nested_elements.length <= 0) {
					wrapper_element = target_element;
				} else if (nested_elements.length > 0) {
					wrapper_element = new TimeContainerPar(id_generator++);
					wrapper_element.appendChild(target_element);
					for (var j = 0; j < nested_elements.length; j++)
						wrapper_element.appendChild(nested_elements[j]);
				}
				target_elements.push(wrapper_element);
			}
		}
		if (target_elements.length > 1) {
			time_item = new TimeContainerSeq(id_generator++);
			for (var i = 0; i < target_elements.length; i++) {
				var target_element = target_elements[i];

				target_element.setAttributes(parseAttributes(element));
				time_item.appendChild(target_element);
			}
		} else if (target_elements.length == 1) {
			time_item = target_elements[0];
		}
		if (time_item !== null) {
			$(element).data('timegraph_node', time_item);
		}

		return time_item;
	}

	function areaLink(element) {
		// parse timing attributes
		// parse href: iri attributes
		// parse: actuate - register an event handler upon activation
		// nohref: ignore
		var area_element = new AreaLink(id_generator++);

		area_element.setAttributes(parseAttributes(element));
		$(element).data('timegraph_node', area_element);

		return area_element;
	}

	function externalTimesheets() {
		/*
		* asynchronously load external timesheets
		*/
		var links = $('link[rel=timesheet]');
		var n_links = links.length;
		var i = n_links;
		var ext_timesheets = [];

		$(parser).bind('timesheet_loaded', function () {
			if (--i == 0)
				$(parser).trigger('external_timesheets_fetched',
					{'timesheets': ext_timesheets});
		});
		if (n_links == 0)
			$(parser).trigger('external_timesheets_fetched',
				{'timesheets': []});
		else for (var j = 0; j < n_links; j++) {
			var href = $(links[j]).attr('href');

			$.get(href, function(data) {
				$(parser).bind('all_nodes_expanded', function (ev) {
					ext_timesheets.push(data);
					$(parser).trigger('timesheet_loaded');
					$(this).unbind(ev);
				});
				_expandTimesheet($(data).find('timesheet').get(0));
			}, "xml").error(function (jqXHR, textStatus, errorThrown) {
				logger.error("cannot load specified timesheet: %1. error: %2"
					.replace('%1', href)
					.replace('%2', errorThrown));
			});
		}
	}

	function _expandTimesheet(timesheet_node) {
		/**
		* expand the local representation of the timesheet by fetching all external timesheets
		*/
		// attempt to expand a new node
		// when finished, notify and try to expand a new one
		// when depleted, clear all traces
		var history = [];
		var nodes = $(timesheet_node).find('timesheet[src]').toArray();
		var stack = [];
		var expand = function () {
			/**
			* expand a 'timesheet' node with the external content, one of:
			* - a whole timesheet
			* - a fragment of an external timesheet (via hash)
			*/
			if (stack.length > 0) {
				var item = stack.pop();
				var node = item['node'];
				var src = $(node).attr('src');
				var hash = null;
				var matches = null;
				var found_circular = false;
				
				matches = src.match(/.+(#.+)/);
				if (matches !== null)
					hash = matches[1];
				for (var i = 0; i < history.length; i++) {
					if (history[i]['src'] == src && 
						item['level'] != history[i]['level'])
						found_circular = true;
				}
				if (found_circular) {
					$(parser).trigger('node_expanded');
				} else {
					$.get(src, function (data) {
						var root = null;
						var inner = null;
						var level = item['level'];
						var attrs = node.attributes;

						if (hash !== null)
							// expand with a fragment
							root = $(data).find(hash).get(0);
						else
							// expand with a whole timesheet
							root = $(data).find('timesheet').get(0);
						inner = $(root).find('timesheet[src]');
						for (var i = 0; i < attrs.length; i++)
							// transfer ref attributes to imported node
							if (!/src|xmlns/i.test(attrs[i]['name']))
								$(root).attr(attrs[i].name, attrs[i].value);
						$(node).replaceWith(root);
						for (var i = 0; i < inner.length; i++)
							stack.push({
								'node': inner[i], 
								'level': level + 1
							});
						history.push({
							'src': src, 
							'level': level
						});
						$(parser).trigger('node_expanded');
					}, 'xml').error(function () {
						logger.error('failed to expand the timesheet from', src);
					});
				}
			} else {
				$(parser).trigger('all_nodes_expanded');
				$(parser).unbind('node_expanded');
			}
		};

		for (var i = 0; i < nodes.length; i++)
			stack.push({
				'node': nodes[i], 
				'level': 0
			});
		$(parser).bind('node_expanded', function () {
			expand();
		});
		expand();
		
	}

	function internalTimesheets() {
		/**
		* load internal timesheets (specified in the header section)
		* FIXME: disabled due to non-conformance to HTML; the document does
		* not validate and the behavior is unpredictable (for instance,
		* Chrome moves the declaration to the body and alters the structure
		* of the nodes)
		*/
		var timesheet_nodes = [];

		return timesheet_nodes;
	}

	function inlineTimesheets() {
		// TODO: inline timesheets would require to identify
		// only the set of top-level time containers and include
		// them in a dumb timesheet node for consistency purposes

		return [];
	}

	function timesheets() {
		/*
		* gather timesheets from three sources and combine the results
		* external timesheets are gathered assynchronously
		*
		* Simplified grammar (very abstract, ignoring most attributes)
		*
		* DOCUMENT := TIMESHEETS*
		* TIMESHEET := '<timesheet>' TIMEELEMENT* '</timesheet>'
		* TIMEELEMENT := TIMECONTAINER | TIMEITEM | AREALINK | TIMESHEET
		* TIMECONTAINER := '<par>' TIMEELEMENT* '</par>' |
			'<seq>' TIMEELEMENT* '</seq>' |
			'<excl>' TIMEELEMENT* '</excl>'
		* TIMEITEM := <item select=' CSSSELECTOR '>' TIMELEMENT* '</item>'
		* AREALINK := '<area />'
		* 
		*
		* * timegraph consistency assumptions:
		* - if more than one timesheet is defined, all timesheets are combined
		* in the same timegraph by using a par container
		* - if an item selector returns more than one element, the item
		* is represented as seq container aggregating the returned elements
		*/
		var timesheet_nodes = [];
		var root_container = null;
		var dom_list = {
			'external': []
		}

		$(parser).bind('external_timesheets_fetched', function (ev, data) {
			var timesheet_docs = data['timesheets'];
			var container_nodes = [];

			for (var i = 0; i < timesheet_docs.length; i++) {
				var doc_node = timesheet_docs[i];
				var external_ts = $(doc_node).find('timesheet').get(0);

				dom_list['external'].push(new TimesheetDocument(doc_node, self));
				if (external_ts) {
					external_ts.timesheet_source = 'external';
					timesheet_nodes.push(external_ts);
				}
			}
			// gather other types of timesheets
			var internal_t = internalTimesheets();
			var inline_t = inlineTimesheets();

			for (var i = 0; i < internal_t.length; i++){
				var internal_node = internal_t[i];

				internal_node.timesheet_source = 'internal';
				timesheet_nodes.push(internal_node);
			}
			for (var i = 0; i < inline_t.length; i++) {
				var inline_node = inline_t[i];

				inline_node.timesheet_souce = 'inline';
				timesheet_nodes.push(inline_node);
			}
			// combine the results: all timesheets are combined in a "implicit"
			// par time container 
			if (timesheet_nodes.length > 1) {
				var children_elements = [];
				var node_id = id_generator++;

				root_container = new TimeContainerPar(node_id);
				for (var i = 0; i < timesheet_nodes.length; i++) {
					var t_node = timesheet_nodes[i];

					children_elements.push(timesheet(t_node));
				}
				root_container.setChildren(children_elements);
			} else if (timesheet_nodes.length == 1) {
				var t_node = timesheet_nodes[0];
				
				root_container = timesheet(t_node);
			}
			// TODO: timesheets for different sources should be merged according
			// to a precedence criteria, similarly to CSS, in this order:
			// inline, internal and external. Implying that conflicting
			// declarations (refering to the same selected element) should be solved
			$(parser).trigger('timesheets_parsed', {'timegraph': root_container, 'dom_list': dom_list});
		});
		externalTimesheets();
	}

	this._checkContinuousMediaElements = function () {
		/**
		* a preliminary pass in the spatial document to check the types of 
		* continuous media elements present, making sure the presentation is 
		* unlocked only after their metadata is resolved
		*/
		var cm = $(document).find('audio,video,iframe[data-mediaelement=youtube]');
		var wait_q_ht = [];
		var wait_q_yt = [];
		var TS = Date.now();
		var POLL_INTERVAL = 50;
		var TIMEOUT = 5000;

		for (var i = 0; i < cm.length; i++) {
			var el = cm[i];

			if (/audio|video/i.test(el.nodeName)) {
				if (el.readyState <= 1) {
					$(el).data('ignore', false);
					wait_q_ht.push(el);
					flags.unresolved_timed_media++;
				}
			} else if (/iframe/i.test(el.nodeName)) {
				wait_q_yt.push(el);
				flags.unresolved_timed_media++;
			}
		}
		// no continuous media elements
		if (wait_q_yt + wait_q_ht == 0)
			$(parser).trigger('media_elements_ready');
		// youtube elements
		if (wait_q_yt.length > 0) {
			// dynamically load the youtube api (if needed) and register 
			// the appropriate callbacks
			window.onYouTubeIframeAPIReady = function () {
				// TODO: register the player ready callback for every player 
				// in the document (we have the list above)
				for (var i = 0; i < wait_q_yt.length; i++) {
					var player = new YT.Player($(wait_q_yt[i]).attr('id'), {
						events: {
							'onReady': onPlayerReady, 
							'onError': onPlayerError
						}
					});
				}
				window.onYouTubeIframeAPIReady = function () {}; // no op
			};
			window.onPlayerReady = function (ev) {
				var idx = wait_q_yt.indexOf(ev.target.a);

				$(ev.target.a).data('yt_player', ev.target);
				wait_q_yt.splice(idx,1);
				flags.unresolved_timed_media--;
				if (wait_q_yt.length == 0) {
					window.onPlayerReady = function () {}; // no op
					$(parser).trigger('media_elements_ready');
				}
			};
			window.onPlayerError = function (ev) {
				console.log('An error was detected on YouTube element', 
					ev.target.a, '. Error code: ', ev.data);
			};
			if (typeof YT === "undefined")
				$.getScript(ACTIVETIMESHEETS.conf['youtube.api']);
		}
		// html5 elements
		if (wait_q_ht.length > 0) {
			poller_id = setInterval(function () {
				for (var i = 0; i < wait_q.length; i++) {
					if (wait_q_ht[i].readyState > 1)
						wait_q_ht.splice(i, 1);
					if (wait_q_ht.length == 0)
						clearInterval(poller_id);
					else if (Date.now() - TS > TIMEOUT) {
						for (var i = 0; i < wait_q.length; i++) {
							console.log('Element', wait_q[i], 'is taking too', 
								'long to yield meatadata. Ignoring it...');
							$(wait_q[i]).data('ignore', true);
							flags.unresolved_timed_media--;
						}
						clearInterval(poller_id);
						$(parser).trigger('media_elements_ready');
					}
				}
			}, POLL_INTERVAL);
		}
	};

	/* public API */

	this.parse = function () {
		/**
		* - triggers the fetching of the external timesheets
		* - record the timesheets in the object state
		* - call the timesheet parsing code for every timesheet node
		* - binds the start of the parsing to the successful loading of the timesheets
		*/
		$(parser).bind('media_elements_ready', function (ev) {
			/**
			* parsing only proceeds when all continuous media elements
			* have metadata
			*/
			logger.debug('media metadata ready. proceeding to timegraph', 
						'computation');
			timesheets();
			$(this).unbind(ev);
		});
		$(parser).bind('timesheets_parsed', function (ev, data) {
			var timegraph = data['timegraph'];
			var dom_list = data['dom_list'];

			if (timegraph) {
				logger.debug('timesheets parsed:', 
					formatter.toHierarchyStr(timegraph));
				$(timegraph).bind('timing_ready', function (ev) {
					logger.debug('timegraph ready:', 
						formatter.toHierarchyStr(timegraph));
					$(parser).trigger('timegraph_ready', {
						'timegraph': timegraph, 
						'dom_list': dom_list
					});
					timegraph.computeTiming();
					timegraph.updateFormatting(true);
					$(this).unbind(ev);
				});
				// if (flags.timed_media.length > 0) {
				// 	var waiting = [];
				// 	var poller_id = null;

				// 	for (var i = 0; i < flags.timed_media.length; i++) {
				// 		// check for blocked elements
				// 		var element = flags.timed_media[i];

				// 		if (element['type'] == 'html5' && element.readyState <= 1)
				// 			waiting.push(element);
				// 		else if (element['type'] == 'youtube')
				// 	}
				// 	if (waiting.length > 0) {
				// 		logger.debug('waiting for media metadata before computing', 
				// 			'timegraph timing...');
				// 		poller_id = setInterval(function () {
				// 			// free the elements as they are unblocked
				// 			for (var i = 0; i < waiting.length; i++) 
				// 				if (waiting[i].readyState > 1)
				// 					waiting.splice(i,1);
				// 			if (waiting.length == 0) {
				// 				clearInterval(poller_id);
				// 				logger.debug('metadata ready by polling. proceeding', 
				// 					'to computation');
				// 				timegraph.computeTiming();
				// 				timegraph.updateFormatting(true);
				// 			}
				// 		}, 500);
				// 	} else {
				// 		timegraph.computeTiming();
				// 		timegraph.updateFormatting(true);
				// 	}
				// } else  {
				// 	timegraph.computeTiming();
				// 	timegraph.updateFormatting(true);
				// }
			} else
				logger.warn('No timesheet specification was associated to the', 
					'current document.');
			$(this).unbind(ev);
		});
		logger.debug('waiting for media metadata before computing', 
					'timegraph timing...');
		this._checkContinuousMediaElements();
	}

	/* methods for incremental parsing */
	this.timesheet = timesheet;
	this.timeElement = timeElement;
	this.parseAttributes = parseAttributes;
	this.parseAttribute = parseAttribute;
	this.getInternalAttrName = getInternalAttrName;
}

/**
* Timegraph Model
*/

function Timer() {
	this._t_start = 0;
	this._timer_id = null;
	this._state = 'idle'; // idle || paused || playing
}

Timer.prototype.play = function () {
	if (this._state == 'idle')
		this._t_start = Date.now();
	else if (this._state == 'paused') {
		// discount paused period
		this._t_start = this._t_start + (Date.now() - this._t_pause);
	}
	this._state = 'playing';
};

Timer.prototype.pause = function () {
	this._t_pause = Date.now();
	this._state = 'paused';
};

Timer.prototype.stop = function () {
	this._t_start = 0;
	this._state = 'idle';
};

Timer.prototype.setTime = function (time) {
	this._t_start = Date.now() - time * 1000 ;
};

Timer.prototype.getTime = function () {
	if (this._state == 'playing')
		return (Date.now() - this._t_start) / 1000;
	else if (this._state == 'paused')
		return (this._t_pause - this._t_start) / 1000;
	else if (this._state == 'idle')
		return 0;
};

Timer.prototype.isPaused = function () {
	return this._state == 'paused';
};

Timer.prototype.isIdle = function () {
	return this._state == 'idle';
};

Timer.prototype.isPlaying = function () {
	return this._state == 'playing';
};

function TimeElement(__node_id, __target_node) {
	/*
	* Base class for all elements of a time graph
	*/
	this._node_id = __node_id;
	this._state = 'idle'; // playing | paused | stalled | frozen | idle
	this._parent = null;
	this._implicit_dur = null;
	this._internal_dur = null;
	this._attrs = {};
	this._active_interval = {
		// relative to the immediate parent (external timing)
		'begin': Infinity,
		'end': Infinity
	};
	this._clipped_interval = {
		// relative to the element (internal timing)
		'begin': Infinity, 
		'end': Infinity
	};
	this._event_handlers = {};
	this._target_node = __target_node || null;
	this._links = [];

	this._time = 0;
	this._speed = 1.0;
	this._time_function = [];
	this._volume = 1.0;
	this._timing_cache = {
		// a cache of timing values to detect 
		// what is affected for active updates
		'begin': 0,
		'clip-begin': 0
	}

	this._bindEvents();
	$(this._target_node).data('timegraph_node', this);
}

TimeElement.prototype = {
	_bindEvents: function () {
		var click_ev = 'click.' + this._node_id;
		var self = this;

		$(this._target_node).bind(click_ev, function () {
			$(self).trigger('activateEvent');
		});
		this._event_handlers[click_ev] = this._target_node;
	}, 

	parentToLocal: function (parent_time) {
		/**
		* convert parent time to local time
		* 
		* @parent_time: if not informed, consider the queried parent time
		*/
		var func = this._time_function[this._time_function.length - 1];
		var ptime = (parent_time === undefined) ? this.getParentTime() : parent_time;

		return (ptime - func['parent_time']) * this._speed + func['local_time'];
		
	},

	localToParent: function (local_time) {
		/**
		* convert local time to parent time
		*
		* @local_time: if not informed, consider queried local time
		*/
		var func = this._time_function[this._time_function.length - 1];

		if (local_time === undefined)
			// internal conversion
			return (this._time + func['parent_time'] * this._speed - 
				func['local_time']) / this._speed;
		else
			// external conversion: discount clip begin
			return (local_time + this._clipped_interval.begin + func['parent_time'] * this._speed - 
				func['local_time']) / this._speed;
	},

	_computeBegin: function() {
		/**
		* compute the begin time based on resolved/unresolved timing semantics
		*
		* @param subscriber_node the node with (event-based) unresolved begin
		* @return a definite begin value
		* 
		* Cases:
		* 1. (special case): time has been resolved by a link activation
		* 2. begin attribute undefined: no begin offset
		* 3. begin attribute unresolved: register resolution callback
		* 4. begin attribute is defined/resolved: assign the provided value
		*/
		var begin_attr = this._attrs['begin'];
		var begin_value = Infinity;

		if (this._attrs['link_begin'] !== undefined) {
			// virtual attribute to signal link-based scheduling
			// remove it after using it
			begin_value = this._attrs['link_begin']['value'];
			delete this._attrs['link_begin'];
		} else if (begin_attr === undefined)
			begin_value = 0;
		else if (begin_attr['type'] == 'event' && 
			begin_attr['status'] == 'unresolved') {
			this._addEventHandler('begin', begin_attr);
		} else if ((begin_attr['type'] == 'event'
			&& begin_attr['status'] == 'resolved') ||
			begin_attr['type'] == 'time' || 
			begin_attr['type'] == 'indefinite') {
			// once begin time is resolved, assign current time as begin time
			begin_value = begin_attr['value'];
		}
		// XXX: what about when the begin value is timeline-based?

		return begin_value;
	},

	_computeSpeed: function (begin) {
		/**
		* update the time function to encompass speed manipulation in the 
		* element, if applicable
		*/
		var ref_time = this.getParentTime();
		var speed = this._attrs['speed'] || 1.0;
		var new_dur = null;
		var time_func_init = this._time_function.length > 0;
		var speed_has_changed = this._attrs['speed'] !== undefined && 
			this._attrs['speed'] !== this._speed;

		this._speed = speed;
		if (time_func_init && speed_has_changed) {
			// add a new entry in the new time function every time the 
			// speed changes
			this._time_function.push({
				'parent_time': ref_time, 
				'local_time': this._time, 
				'speed': this._speed
			});
			logger.debug('speed on element', this, this._node_id, 'changed to', speed);
		}
	},

	_computeClipping: function() {
		/**
		* establishes the internal interval of the element respecting the 
		* clipping
		* attributes
		*/
		var clip_begin_attr = this._attrs['clip-begin'];
		var clip_end_attr = this._attrs['clip-end'];
		var clip_begin = null;
		var clip_end = null;
		var duration = this._implicit_dur;

		// build the clipping interval, if possible
		if (clip_begin_attr === undefined)
			clip_begin = 0;
		else if (clip_begin_attr !== undefined && clip_begin_attr['value'] > duration)
			clip_begin = duration;
		else
			clip_begin = clip_begin_attr['value'];
		if (clip_end_attr === undefined || clip_end_attr['value'] > duration)
			clip_end = duration;
		else
			clip_end = clip_end_attr['value'];
		if (clip_end < clip_begin)
			clip_end = clip_begin;
		this._clipped_interval.begin = clip_begin;
		this._clipped_interval.end = clip_end;
		// update the interval duration to the clipped interval
		this._implicit_dur = this._clipped_interval.end - 
			this._clipped_interval.begin;
	},

	_computeDuration: function(begin_value) {
		/**
		* compute the duration of an element based on resolved/unresolved and
		* end/dur semantics
		* Cases:
		* 1. unresolved 'end': duration is infinite; register resolution callback
		* 2. resolved (undeterministic)'end': duration is finite; record based on current clock instant
		* 3. resolved (deterministic) 'end': duration is finite; record based on provided value
		* 4. explicit 'dur': duration is finite; extract from attribute value
		* 5. implicit 'dur': duration is finite/infinite, depending on intrinsic resolution
		*/
		var end_attr = this._attrs['end'];
		var end_value = null;
		var explicit_dur = this._attrs['dur'];
		var actual_dur = Infinity;
		var endsync = this._attrs['endsync']

		if (end_attr !== undefined && end_attr['type'] == 'event' &&
			end_attr['status'] == 'unresolved') {
			this._addEventHandler('end', end_attr)
		} else if (end_attr !== undefined && end_attr['type'] == 'event' &&
			end_attr['status'] == 'resolved') {
			end_value = end_attr['value'];
			actual_dur = (end_value - begin_value) > 0 ? end_value - begin_value : 0;
			this._internal_dur = actual_dur;
		} else if (end_attr !== undefined && (end_attr['type'] == 'time' || 
			end_attr['type'] == 'indefinite')) {
			end_value = end_attr['value'];
			actual_dur = (end_value - begin_value) > 0 ? end_value - begin_value : 0;
			this._internal_dur = actual_dur;
		} else if (explicit_dur !== undefined && explicit_dur['type'] == 'time')
			actual_dur = explicit_dur['value'];
		else if (explicit_dur !== undefined && explicit_dur['type'] == 'indefinite')
			actual_dur = explicit_dur['value'];
		else if (this._implicit_dur !== null) {
			if (begin_value < Infinity) {
				// resolved begin, use the (now initialized) time function
				// compute the duration of the element in the parent scope
				var f0 = this._time_function[0];
				var fn = this._time_function[this._time_function.length - 1];
				var t0 = (this._clipped_interval.begin + f0['parent_time'] * f0['speed'] - f0['local_time']) / f0['speed'];
				var tn = (this._clipped_interval.end + fn['parent_time'] * fn['speed'] - fn['local_time']) / fn['speed'];

				actual_dur = tn - t0;
			} else
				// unresolved begin, it doesn't matter the return value
				actual_dur = this._implicit_dur;
			this._internal_dur = this._implicit_dur;
		}

		return actual_dur;
	},

	_addEventHandler: function(attr_name, attr) {
		/*
		* add an event handler for a event-based begin/end attribute
		* notice that multiple subscribers can bind to the same publisher
		*
		* @param attr_name: the name of the attribute to be resolved
		* @param attr the dictionary for the event-based begin|end attribute
		*/
		// ownerDocument ensures that the id is resolved in the right scope
		// (e.g. external or inline timesheet)
		// FIXME: but for external timesheet it doesnt matter who the target is
		// TODO: extend the binding to user-triggered events (e.g. click)
		var target_res = $(attr['dom'].ownerDocument).find('#' + attr['target_id']);

		if (target_res.length > 0) {
			var target_dom = target_res.get(0);
			var publisher_node = null;
			var subscriber_node = this;
			var ev_name_ns = [];
			var ev_name = null;

			publisher_node = $(target_dom).data('timegraph_node');

			if (attr['event'] == 'begin')
				ev_name_ns.push('beginEvent');
			else if (attr['event'] == 'end')
				ev_name_ns.push('endEvent');
			else if (attr['event'] == 'click' || attr['event'] == 'activate')
				ev_name_ns.push('activateEvent');
			ev_name_ns.push(subscriber_node._node_id);
			ev_name_ns.push(attr_name);
			ev_name = ev_name_ns.join('.');

			// event activation restrictions: 
			// 1. if the parent element is not active, the event is ineffective
			// 2. if the parent is active, and if the element is not active, only begin events are effective
			// 3. if the parent is active, and if the element is active, end events are effective

			$(publisher_node).unbind(ev_name);
			$(publisher_node).bind(ev_name, function (ev) {
				/*
				* register the timing resolution callback
				*/
				var parent = subscriber_node._parent;
				var apply = true;

				if (parent !== null && !parent.isActive())
					apply = false;
				else if (parent !== null && parent.isActive() && 
					!subscriber_node.isActive() && (attr_name == 'end' || 
						attr_name == 'click' || attr_name == 'activate'))
					apply = false;
				if (apply) {
					var value =  parent.getTime() + attr['delta'];

					attr['status'] = 'resolved';
					attr['value'] = (value > 0) ? value : 0;
					// recompute affected nodes
					// TODO: activate should not be treated like that: they should be treated
					// like links
					subscriber_node.updateTiming();
					$(document).trigger('timing_resolved',
						{'sub_node_id': subscriber_node._node_id,
						'pub_node_id': publisher_node._node_id,
						'ev_name': ev_name, 
						'attr_name': attr_name
						});
				}
			});
			this._event_handlers[ev_name] = publisher_node;
		}
	},

	_computeTimeFunction: function (begin) {
		/**
		* initialize or update the time function as needed
		*/
		var hoffset = null;

		if (this._parent !== null && this._parent.getType() == 'seq' && 
			this._active_interval.begin < Infinity)
			// discount seq offset from horizontal translation
			hoffset = this._active_interval.begin;
		else
			hoffset = begin;

		if (this._time_function.length == 0 && begin < Infinity) {
			// starts a new time function
			this._time_function = [{
				'parent_time': hoffset, 
				'local_time': this._clipped_interval.begin, 
				'speed': this._speed
			}];
		} else if (begin != this._timing_cache['begin'] || 
			this._clipped_interval.begin != this._timing_cache['clip-begin'] || 
			this._active_interval.begin != this._timing_cache['active_begin']) {
			// begin or clip-begin has changed: restart the function and seek to the element
			// if it is active
			this._time_function = [{
				'parent_time': hoffset, 
				'local_time': this._clipped_interval.begin, 
				'speed': this._speed
			}];
			if (this.isActive())
				this.linkActivate();
		} 
	},

	updateTimeFunction: function () {
		/**
		* should be called by seq containers after a relayout
		*/
		this._computeTimeFunction(this._computeBegin());
	},


	computeTiming: function () {
		/*
		* - compute the active interval for a graph (leaf) node
		* based on the semantics of begin, dur and end attributes
		* - compute the active intervals of the child links
		*/
		var begin = this._computeBegin();
		var dur = null;
		var end = null;
		var old_dur = this.getDur();
		var latest_point = 0;

		// compute link intervals
		for (var i = 0; i < this._links.length; i++) {
			this._links[i].computeTiming();
			if (this._links[i]._active_interval.end > latest_point)
				latest_point = this._links[i]._active_interval.end;
		}
		if (latest_point > this._implicit_dur)
			this._implicit_dur = latest_point;
		// compute clipping
		this._computeClipping();
		// compute speed
		this._computeSpeed(begin);
		// compute time function
		this._computeTimeFunction(begin);
		// compute remaining attributes
		dur = this._computeDuration(begin);
		end = begin + dur;
		// define the active interval
		this._active_interval.begin = begin;
		this._active_interval.end = end;
		// update timing cache
		this._timing_cache['begin'] = begin;
		this._timing_cache['clip-begin'] = this._clipped_interval.begin;
		this._timing_cache['active_begin'] = this._active_interval.begin;
		if (old_dur !== this.getDur())
			$(this).trigger('duration_changed');
		this._time = this._clipped_interval.begin;
	},

	updateTiming: function () {
		/**
		* update current node and forward modifications up to the tree
		*/
		this.computeTiming();
		if (this._parent !== null)
			this._parent.updateTiming(this);
	},

	update: function () {
		/**
		* translate the local time from parent time
		* if the node is the root, time should be updated externally via setTime()
		*/
		if (this._parent !== null) {
			// compute local time
			var time = this.parentToLocal();

			if (this._implicit_dur > 0)
				// freezing conditions for continuous media elements
				if (!this.isFrozen() && time >= this._clipped_interval.end) {
					// 1. element is unfrozen and current time exceeds: freeze it
					this._state = 'frozen';
					logger.debug('freezing clip', this._clipped_interval.begin, 
						this._clipped_interval.end, 'from', this, this._node_id, 
						'at', time);
				} else if (time < this._clipped_interval.end) {
					// 2. regular case
					this._time = time;
					if (this.isFrozen()) {
						// 2.1. it is frozen
						logger.debug('unfreezing clip', this._clipped_interval.begin, 
						this._clipped_interval.end, 'from', this, this._node_id, 
						'at', this._time);
						this._state = 'playing';
					}
				}
		}
		for (var i = 0; i < this._links.length; i++) {
			// process internal links
			var link = this._links[i];
			var overlaps = this._time >= link._active_interval.begin && 
				this._time < link._active_interval.end;

			// schedule
			if (!link.isActive() && overlaps) {
				link.activate();
			} else if (link.isActive() && !overlaps) {
				link.deactivate();
			}
			// update
			if (link.isActive())
				link.update();
		}
	},

	findById: function (_id) {
		/**
		* find a timegraph node by its dom element id, via DFS
		* XXX: a better approach would be to keep a sorted list of ids and node 
		* references
		*/
		var root = this;
		var found = false;
		var stack = [];
		var res = null;

		while (root._parent !== null)
			root = root._parent;
		stack.push(root);
		while (stack.length > 0 && !found) {
			var el = stack.pop();

			if (el._attrs['id'] == _id) {
				found = true;
				res = el;
			} else 
				stack = stack.concat(el.getChildren());
		}

		return res;
	},

	getChildren: function () {
		return this._links;
	},

	seek: function () {
		/**
		* update the time of element to the parent's time; in the case of 
		* backward seek also adjust the time function
		* cases:
		* 1. the seek is backward
		* - find the first time function piece before current parent time
		* - if a piece is found
		*    - remove all function pieces from this point on
		*    - update the implicit duration
		*    - add a new function piece with current time
		* 2. the seek is forward
		* - only update the current time
		*/
		var ptime = this.getParentTime();
		var found_idx = -1;
		var i = 0;

		while (i < this._time_function.length && found_idx < 0) {
			if (this._time_function[i]['parent_time'] >= ptime)
				found_idx = i;
			i++;
		}
		if (found_idx > 0) {
			var howmany = this._time_function.length - found_idx;
			var last_piece = null;

			// remove all pieces forward now
			this._time_function.splice(found_idx, howmany);
			if (this._parent !== null)
				// update current time
				this._time = this.parentToLocal();
			// add a new piece to the function, in case the speed differs
			last_piece = this._time_function[this._time_function.length - 1];
			if (last_piece === undefined || 
				last_piece['speed'] != this._speed)
				this._time_function.push({
					'parent_time': ptime, 
					'local_time': this._time, 
					'speed': this._speed
				});
			// make sure the prediction of the implicit duration is updated
			TimeElement.prototype.computeTiming.call(this);
		} 
		else if (this._parent !== null)
			this._time = this.parentToLocal();
	},

	_reset: function () {
		/*
		* reset the element to its initial (post- timing computation) state
		*/
		var begin_attr = this._attrs['begin'];
		var end_attr = this._attrs['end'];

		if (begin_attr !== undefined && begin_attr['type'] == 'event') {
				begin_attr['status'] = 'unresolved';
				begin_attr['value'] = Infinity;
		} else if (begin_attr !== undefined && 
			begin_attr['type'] == 'indefinite')
			begin_attr['value'] = Infinity;
		if (end_attr && end_attr['type'] == 'event') {
				end_attr['status'] = 'unresolved';
				end_attr['value'] = Infinity;
		} else if (end_attr !== undefined && 
			end_attr['type'] == 'indefinite')
			end_attr['value'] = Infinity;
		for (var i = 0; i < this._links.length; i++)
			this._links[i]._reset();
		this._time_function = [];
		this._volume = this._attrs['volume'] || 1.0;
		this._state = 'idle';
		this.computeTiming();
		this.updateFormatting();
		$(this._target_node).attr('smil', 'idle');
	}, 

	destroy: function () {
		/*
		* unbind all associated events
		*/
		for (var k in this._event_handlers)
			$(this._event_handlers[k]).unbind(k);
		$(this._target_node).removeData('timegraph_node');
	},

	updateFormatting: function () {
		/**
		* update element properties that are timing-independent
		*/
		if (this._attrs['volume'] === undefined)
			this._volume = 1.0;
		else 
			this._volume = this._attrs['volume'];
	},

	getCascadedSpeed: function () {
		/*
		* compute local speed as filtered by ancestors speed
		*/
		if (this._parent !== null)
			return this._speed * this._parent.getCascadedSpeed();
		else
			return this._speed;
	},

	getCascadedVolume: function () {
		/*
		* compute local volume as filtered by ancestors volume
		*/
		if (this._parent !== null)
			return this._volume * this._parent.getCascadedVolume();
		else
			return this._volume;
	},

	setTime: function (time) {
		if (time < this._active_interval.begin)
			this._time = this._active_interval.begin;
		else if (time > this._active_interval.end)
			this._time = this._active_interval.end;
		else 
			this._time = time * this._speed;
	},

	setAttributes: function (a) {
		this._attrs = a;
	},

	setAttribute: function (a) {
		for (var k in a) {
			this._attrs[k] = a[k];
		}
	},

	removeAttribute: function (name) {
		delete this._attrs[name];
	},

	setLinks: function (ls) {
		this._links = ls;
		for (var i = 0; i < this._links.length; i++)
			this._links[i]._parent = this;
	},

	addLink: function (l) {
		l._parent = this;
		this._links.push(l);
	}, 

	getDur: function () {
		return this._active_interval.end - this._active_interval.begin;
	},

	getInternalDur: function () {
		return this._internal_dur;
	},

	activate: function () {
		logger.debug('activating clip', this._clipped_interval.begin, 
			this._clipped_interval.end, 'for', this, this._node_id);
		this._state = 'playing';
		$(this._target_node).attr('smil', 'active');
	},

	deactivate: function () {
		logger.debug('deactivating clip', this._clipped_interval.begin, 
			this._clipped_interval.end, 'for', this, this._node_id);
		for (var i = 0; i < this._links.length; i++)
			this._links[i].deactivate();
		this._reset();
	},

	isActive: function () {
		return this._state != 'idle';
	},

	isPaused: function () {
		return this._state == 'paused';
	},

	isPlaying: function () {
		return this._state == 'playing';
	},

	isFrozen: function () {
		return this._state == 'frozen';
	},

	isStalled: function () {
		return this._state == 'stalled';
	},

	isIdle: function () {
		return this._state == 'idle';
	}, 

	getTime: function () {
		return this._time;
	},

	getParentTime: function () {
		/**
		* fallback to local time if no parent is defined
		*/
		return (this._parent === null) ? this._time : this._parent._time;
	},

	_validate_time: function (time) {
		/*
		* ensure the moment is contained in the active interval
		* TODO: validate the time to the internal interval
		*/
		var valid_time = null;

		if (time == null || time === undefined || time < 0) 
			valid_time = 0;
		else if (time > this._internal_dur)
			valid_time = this._internal_dur;
		else
			valid_time = time;

		return valid_time;
	}, 

	linkActivate: function (time) {
		/**
		* activation via link
		* - translate the time to parent scope and perform a seek
		* - resolve any unresolved ancestors, if necessary
		*/
		var parent = this._parent;
		var cur = this;
		var seek_time = this._validate_time(time);

		logger.debug('node', this, this._node_id, 'activated via link');
		if (this._active_interval.begin == Infinity) {
			// unresolved interval; try to resolve it up to the hierarchy
			var p = this._parent;
			var found = false;
			var visited = [this];

			while (p !== null && !found) {
				// find a parent with resolved begin
				if (p._active_interval.begin < Infinity)
					found = true;
				else {
					visited.push(p);
					p = p._parent;
				}
			}
			if (!found)
				// unresolved root (unlikely to happen, there's always 
				// the implicit container)
				p._active_interval.begin = 0;
			while (visited.length > 0) {
				// propagate the resolved begin down the graph
				var v = visited.pop();

				v._attrs['link_begin'] = {
					// 'virtual' attribute to inhibit regular scheduling
					'type': 'time',
					'value': p.getTime()
				}
				p = v;
			}
			// update timing with new begin values
			p.updateTiming();
		}
		while (parent !== null) {
			// translate the time to the root time
			// seek_time = cur._active_interval.begin + seek_time;
			seek_time = cur.localToParent(seek_time);
			cur = parent;
			parent = parent._parent;
		}
		cur._presentation._seek(seek_time);
		$(document).trigger('link_activated', {'target': this});
	}, 

	find: function (id) {
		/**
		* depth-first search on links by attr 'id'
		*/
		var found = false;
		var i = 0;
		var node = null;

		while (i < this._links.length && !found) {
			var l = this._links[i++];

			if (l._attrs['id'] == id) {
				node = l;
				found = true;
			}
		}
		
		return node;
	}, 

	pause: function () {
		if (this.isPlaying()) {
			this._state = 'paused';
			for (var i = 0; i < this._links.length; i++)
				this._links[i].pause();
			$(this).trigger('paused');
		}
	},

	play: function () {
		if(this.isPaused()) {
			this._state = 'playing';
			$(this).trigger('playing');
		}
	}
};

function AreaLink(__node_id) {
	TimeElement.call(this, __node_id);
}

ACTIVETIMESHEETS.util.inherits(TimeElement, AreaLink);

AreaLink.prototype.activate = function () {
	if (this.isActive())
		return;
	AreaLink._superClass.activate.call(this);
	if (this._parent !== null && this._parent._target_node != null)
		$(this._parent._target_node).attr('smil-link', 'active');
	if (this._attrs['actuate']) {
		// TODO: extend this code to work with external urls 
		// TODO: extend to work with the "target" attribute
		if (this._attrs['href']) {
			// assume href is a fragment identifier
			var el_id = this._attrs['href'].replace('#', '');
			var el = this.findById(el_id);

			if (el !== null) {
				logger.debug('link', this, this._node_id, 'activated on load');
				el.linkActivate();
			}
		}
		if (this._attrs['sourceplaystate'] !== undefined)
			// XXX: we should find a way of implementing this behavior
			// without using module-global variables
			if (this._attrs['sourceplaystate'] == 'play') {
				logger.debug('link', this, this._node_id, 'playing presentation');
				presentation.play();
			} else if (this._attrs['sourceplaystate'] == 'pause'){
				logger.debug('link', this, this._node_id, 'pausing presentation');
				presentation.pause();
			} else if (this._attrs['sourceplaystate'] == 'stop') {
				logger.debug('link', this, this._node_id, 'stopping presentation');
				presentation.stop();
			}
		if (this._attrs['destinationplaystate'] !== undefined)
			// TODO: implement node play/pause behavior for this to work
			// TODO: restrict application only to internal nodes
			if (this._attrs['destinationplaystate'] == 'play')
				;
			else if (this._attrs['destinationplaystate'] == 'pause')
				;
	}
	logger.debug('begin on', this, this._node_id);
	$(this).trigger('beginEvent', {'node_id': this._node_id});
};

AreaLink.prototype.deactivate = function (skip_event) {
	if (!this.isActive())
		return;
	AreaLink._superClass.deactivate.call(this);
	if (this._parent !== null && this._parent._target_node != null)
		$(this._parent._target_node).attr('smil-link', 'inactive');
	logger.debug('end on', this, this._node_id);
	if (!skip_event)
		$(this).trigger('endEvent', {'node_id': this._node_id});
	else
		logger.debug('endEvent for', this, this._node_id, 'skipped');
};

AreaLink.prototype._wrapTarget = function () {
	// TODO: wrap the target html node into an anchor to the target
	// target: replicate the same properties from html
};

AreaLink.prototype._unwrapTarget = function () {
	// TODO: remove the html anchor upon deactivation
};

AreaLink.prototype.getType = function () {
	return 'area';
};

function TimeContainer(__node_id) {
	TimeElement.call(this, __node_id);

	this._children = [];
	this._clipped_interval = {begin: Infinity, end: Infinity};
}

ACTIVETIMESHEETS.util.inherits(TimeElement, TimeContainer);

TimeContainer.prototype.updateFormatting = function (recurse) {
	TimeContainer._superClass.updateFormatting.call(this);
	if (recurse)
		for (var i = 0; i < this._children.length; i++)
			this._children[i].updateFormatting(recurse);

};

TimeContainer.prototype.deactivate = function (skip_event) {
	for (var i = 0; i < this._children.length; i++)
		this._children[i].deactivate(skip_event);
	TimeContainer._superClass.deactivate.call(this);
};

TimeContainer.prototype.getChildren = function () {
	return this._links.concat(this._children);
};

TimeContainer.prototype.setChildren = function (c) {
	this._children = c;
	for (var i = 0; i < this._children.length; i++)
		this._children[i]._parent = this;
};

TimeContainer.prototype.appendChild = function (c) {
	c._parent = this;
	this._children.push(c);
};

TimeContainer.prototype.replaceChild = function (old_c, new_c) {
	var index = this._children.indexOf(old_c);
	var res = null;

	if (index >= 0) {
		res = this._children[index];
		new_c._parent = this;
		this._children[index] = new_c;
	}

	return res;
};

TimeContainer.prototype.addChildBefore = function (child, ref) {
	/**
	* add a child after a specific node
	* 
	* @child the node to be added
	* @ref the node serving as reference position
	*/
	// FIXME: linear search to find the index; replace by other data structure
	var index = this._children.indexOf(ref);

	if (index >= 0) {
		child._parent = this;
		this._children.splice(index, 0, child);
	}
};

TimeContainer.prototype.addChildAfter = function (child, ref) {
	/**
	* add a child after a specific node
	* 
	* @child the node to be added
	* @ref the node serving as reference position
	*/
	// FIXME: linear search to find the index; replace by other data structure
	var index = this._children.indexOf(ref);

	if (index >= 0) {
		child._parent = this;
		this._children.splice(index + 1, 0, child);
	}
};

TimeContainer.prototype.removeChild = function (child) {
	/**
	* remove a child from the container
	*/
	// FIXME: linear search to find the index
	var index = this._children.indexOf(child);

	if (index >= 0) {
		this._children[index].destroy();
		this._children.splice(index, 1);
	}
};

TimeContainer.prototype.pause = function () {
	if (this.isPlaying()) {
		TimeContainer._superClass.pause.call(this);
		for (var i = 0; i < this._children.length; i++)
			this._children[i].pause();
	}
};

TimeContainer.prototype.play = function () {
	if (this.isPaused()) {
		TimeContainer._superClass.play.call(this);
		for (var i = 0; i < this._children.length; i++) {
			this._children[i].play();
		}
	}
};

TimeContainer.prototype.find = function (id) {
	/**
	* depth-first search on children by attr id
	*/
	var node = TimeContainer._superClass.find.call(this, id);

	if (node == null) {
		var found = false;
		var i = 0;

		while (i < this._children.length && !found) {
			var c = this._children[i++];

			if (c._attrs['id'] == id) {
				// check if the child matches
				node = c;
				found = true;
			} else {
				// recurse to the child
				node = c.find(id);
				if (node !== null)
					found = true;
			}
		}
	}

	return node;
};

function TimeContainerPar(__node_id) {
	TimeContainer.call(this, __node_id);

	// this._timer._time_element = this;
}

ACTIVETIMESHEETS.util.inherits(TimeContainer, TimeContainerPar);

TimeContainerPar.prototype._computeImplicitDur = function (earliest_end, latest_end) {
	/**
	* compute the implicit duration with endsync semantics or defaults
	* NOTICE: here, the default is assumed to be endsync=all, which deviates
	* from the SMIL recommendation (should be endsync=last)
	*/
	if (this._attrs['endsync'] !== undefined) {
		if (/first/i.test(this._attrs['endsync']['value']))
			this._implicit_dur = earliest_end;
		else if (/last/i.test(this._attrs['endsync']['value'])) {
			this._implicit_dur = latest_end;
		} else if (/^((?:\w|\d)+)/.test(this._attrs['endsync']['value'])) {
			// identifier
			// FIXME: we must make sure that the identifier is a child of the 
			// this container
			var dom_node = this._attrs['endsync']['dom'];
			var target_res = $(dom_node.ownerDocument).find('#' + this._attrs['endsync']['value']);

			if (target_res.length > 0) {
				var dom_node = target_res.get(0);
				var tg_node = $(dom_node).data('timegraph_node');

				if (tg_node._parent === this)
					this._implicit_dur = tg_node._active_interval.end;
				else
					this._implicit_dur = latest_end;
			} else 
				this._implicit_dur = latest_end;
		}
	} else 
		this._implicit_dur = latest_end;
};

TimeContainerPar.prototype.computeTiming = function () {
	/**
	* compute the schedule for a par time container
	* 1. lay out the children active intervals according to par semantics
	* 2. compute the active interval
	*/
	var latest_end = 0;
	var earliest_end = Infinity;

	// compute implicit duration and temporal layout
	for (var i = 0; i < this._children.length; i++) {
		var child = this._children[i];

		// tracking of container implicit duration
		child.computeTiming();
		if (child._active_interval.end > latest_end)
			latest_end = child._active_interval.end;
		if (child._active_interval.end < earliest_end)
			earliest_end = child._active_interval.end;
	}
	this._computeImplicitDur(earliest_end, latest_end);
	TimeContainerPar._superClass.computeTiming.call(this);
	$(this).trigger('timing_ready');
};

TimeContainerPar.prototype.updateTiming = function (affected_node) {
	/*
	* compute the container timing without recursing to the children
	*/
	var parent = this._parent;
	var children = this._children;
	var latest_point = 0;
	
	for (var i = 0; i < children.length; i++) {
		var interval = children[i]._active_interval;

		if (interval.end > latest_point)
			latest_point = interval.end;
	}
	this._implicit_dur = latest_point;
	TimeContainerPar._superClass.computeTiming.call(this);
	if (parent !== null)
		parent.updateTiming(this);
};

TimeContainerPar.prototype._reset = function () {
	/*
	* reset children, indeterminate scheduling points and recompute 
	* 
	*/
	var latest_point = 0;

	for (var i = 0; i < this._children.length; i++) {
		var child = this._children[i];
		var interval = null;

		if (!child.isIdle())
			child._reset();
		interval = child._active_interval;
		if (interval.end > latest_point)
			latest_point = interval.end;
	}
	this._implicit_dur = latest_point;
	TimeContainerPar._superClass._reset.call(this);
};

TimeContainerPar.prototype.update = function () {
	/**
	* issues:
	* - actual_duration > implicit_duration: freeze, for every child
	* freeze conditions (for children):
	* - implicit duration surpassed by active interval
	* - active interval surpassed by containers's
	*/
	// schedule children
	TimeContainer._superClass.update.call(this);
	for (var i = 0; i < this._children.length; i++) {
		var child = this._children[i];
		var overlaps = this._time >= child._active_interval.begin && 
			this._time < child._active_interval.end;

		if (!child.isActive() && overlaps)
			child.activate();
		else if (child.isActive() && !overlaps)
			child.deactivate();
		if (child.isActive())
			child.update();
	}
	// root container (implicit container) is finishing, must deactivate itself
	// if the semantics of the implicit container changes, this must be moved
	// somewhere else
	if (this._parent === null && this._time >= this._active_interval.end) {
		this.deactivate();
		this._reset(true);
	}
};

TimeContainerPar.prototype.seek = function () {
	/**
	* make sure the all elements that should not be scheduled at this time 
	* are deactivated without raising events
	*/

	TimeContainerPar._superClass.seek.call(this);
	for (var i = 0; i < this._children.length; i++) {
		var child = this._children[i];
		
		if (this._time >= child._active_interval.end)
			child.deactivate(true);
		if (child.isActive())
			child.seek();
	}
};

TimeContainerPar.prototype.activate = function () {
	if (this.isActive())
		return;
	logger.debug('begin on', this, this._node_id);
	TimeContainerPar._superClass.activate.call(this);
	$(this).trigger('beginEvent', {'node_id': this._node_id});
};

TimeContainerPar.prototype.deactivate = function (skip_event) {
	if (!this.isActive())
		return;
	TimeContainerPar._superClass.deactivate.call(this, skip_event);
	logger.debug('end on', this, this._node_id);
	if (!skip_event)
		$(this).trigger('endEvent', {'node_id': this._node_id});
	else
		logger.debug('endEvent for', this, this._node_id, 'skipped');
};

TimeContainerPar.prototype.getType = function () {
	return 'par';
};

function TimeContainerSeq(__node_id) {
	TimeContainer.call(this, __node_id);

	this._child_cache = {}; // original (un-layed-out) children intervals
	this._active_child = null;

	// this._timer._time_element = this;
}

ACTIVETIMESHEETS.util.inherits(TimeContainer, TimeContainerSeq);

TimeContainerSeq.prototype._layout_children = function() {
	/**
	* layout the children without recursively recomputing
	* their active interval
	* - layout based on cached (relative) values
	*/
	var last_point = 0;
	var i = 0;
	var children = this._children;
	var cache = this._child_cache;
	var is_resolved = true;
	
	while (i < children.length && is_resolved) {
		var child = children[i];
		var a_interval = {
			begin: cache[child._node_id].begin, 
			end: cache[child._node_id].end
		};

		if (a_interval.end == Infinity) {
			// if an interval is unresolved, stops the layout
			a_interval.begin += last_point;
			child._active_interval.begin = a_interval.begin;
			is_resolved = false;
		} else {
			a_interval.begin += last_point;
			a_interval.end += last_point;
			last_point = a_interval.end;
			child._active_interval.begin = a_interval.begin;
			child._active_interval.end = a_interval.end;
		}
		child.updateTimeFunction();
		i++;
	}
	return is_resolved;
};

TimeContainerSeq.prototype.removeChild = function(child) {
	delete this._child_cache[child._node_id];
	TimeContainerSeq._superClass.removeChild.call(this, child);
};

TimeContainerSeq.prototype.computeTiming = function () {
	var children = this._children;

	for (var i = 0; i < children.length; i++) {
		var child = children[i];

		child.computeTiming();
		this._child_cache[child._node_id] = {
			begin: child._active_interval.begin, 
			end: child._active_interval.end
		};
	}
	if (children.length > 0) {
		var last_child = children[children.length - 1];

		if (this._layout_children())
			this._implicit_dur = last_child._active_interval.end;
		else
			// unresolved child
			this._implicit_dur = Infinity;
		this._active_child = this._children[0];
	} else
		this._implicit_dur = 0;
	TimeContainerSeq._superClass.computeTiming.call(this);
};

TimeContainerSeq.prototype.updateTiming = function (affected_node) {
	/**
	* recompute the timing of the container without recursing 
	* to the children, but recursing to the parents
	* - check if any child interval has been changed
	* - if it has, update the cache and re-layout the children
	*/
	var children = this._children;
	var parent = this._parent;
	var last_child = children[children.length - 1];
	var resolved = false;

	if (affected_node !== undefined) {
		var active_interval = affected_node._active_interval;

		this._child_cache[affected_node._node_id].begin = active_interval.begin;
		this._child_cache[affected_node._node_id].end = active_interval.end;
	}
	resolved = this._layout_children();
	if (children.length > 0) {
		this._active_child = this._children[0]; // delegate to next clock update
		if (resolved)
			this._implicit_dur = last_child._active_interval.end;
		else
			// unresolved child
			this._implicit_dur = Infinity;
	} else if (children.length == 0)
		this._implicit_dur = 0;
	TimeContainerSeq._superClass.computeTiming.call(this);
	if (parent !== null)
		parent.updateTiming(this);
};

TimeContainerSeq.prototype._reset = function () {
	var resolved = false;

	for (var i = 0; i < this._children.length; i++) {
		// reset all children nodes
		var child = this._children[i];

		if (!child.isIdle())
			child._reset();
		this._child_cache[child._node_id] = {
			begin: child._active_interval.begin, 
			end: child._active_interval.end
		};
	}
	if (this._children.length > 0) {
		var last_child = this._children[this._children.length - 1];

		if (this._layout_children())
			this._implicit_dur = last_child._active_interval.end;
		else
			// unresolved child
			this._implicit_dur = Infinity;
		this._active_child = this._children[0];
	} else
		this._implicit_dur = 0;
	TimeContainerSeq._superClass._reset.call(this);
};

TimeContainerSeq.prototype.update = function () {
	/**
	* iterate over the sequence according to active intervals
	*/
	var a_child_idx = this._children.indexOf(this._active_child);

	TimeContainerSeq._superClass.update.call(this);
	// schedule and update children
	if (a_child_idx >= 0) {
		var child = this._children[a_child_idx];
		var overlaps = this._time >= child._active_interval.begin && 
			this._time < child._active_interval.end;

		if (!child.isActive() && overlaps)
			child.activate();
		else if (child.isActive() && this._time > child._active_interval.end) {
			child.deactivate();
			a_child_idx++;
			if (a_child_idx < this._children.length)
				this._active_child = this._children[a_child_idx];
		}
		if (child.isActive())
			child.update();
	}
};

TimeContainerSeq.prototype.seek = function () {
	var active_interval = this._active_interval;
	var i = 0;
	var found = false;
	var cur_child = null;

	// propagate to the children
	TimeContainerSeq._superClass.seek.call(this);
	while (i < this._children.length && !found) {
		// find the child to be activated
		var interval = null;
		var overlaps = null;

		cur_child = this._children[i];
		interval = cur_child._active_interval
		overlaps = this._time >= interval.begin && this._time < interval.end
		if (!cur_child.isActive() && overlaps) {
			// deactivate current child (without raising event) and activate
			// the relevant child
			if (this._active_child.isActive())
				this._active_child.deactivate(true);
			this._active_child = cur_child;
			cur_child.activate();
			cur_child.seek();
			found = true;
		}
		i++;
	}
	if (i == this._children.length && this._time >= 
		cur_child._active_interval.end)
		// deactivate last child
		cur_child.deactivate(true);
};


TimeContainerSeq.prototype.activate = function () {
	if (this.isActive())
		return;

	TimeContainerSeq._superClass.activate.call(this);
	logger.debug('begin on', this, this._node_id);
	$(this).trigger('beginEvent', {'node_id': this._node_id});
};

TimeContainerSeq.prototype.deactivate = function (skip_event) {
	if (!this.isActive())
		return;
	TimeContainerSeq._superClass.deactivate.call(this, skip_event);
	logger.debug('end on', this, this._node_id);
	if (!skip_event)
		$(this).trigger('endEvent', {'node_id': this._node_id});
	else
		logger.debug('endEvent for', this, this._node_id, 'skipped');
};

TimeContainerSeq.prototype.getType = function () {
	return 'seq';
};


function TimeContainerExcl(__node_id) {
	TimeContainer.call(this, __node_id);

	this._child_cache = {};
	this._active_child = null;
	this._pq = new ACTIVETIMESHEETS.util.MinPriorityQueue();
}

ACTIVETIMESHEETS.util.inherits(TimeContainer, TimeContainerExcl);

TimeContainerExcl.prototype.removeChild = function (child) {
	delete this._child_cache[child._node_id];
	TimeContainerExcl._superClass.removeChild.call(this, child);
};

TimeContainerExcl.prototype._buildSchedule = function () {
	var input = [];

	for (var i = 0; i < this._children.length; i++) {
		var child = this._children[i];

		if (!this._child_cache[child._node_id].visited)
			input.push([child._active_interval.begin, child]);
	}
	this._pq.clear();
	this._pq.build(input);
};

TimeContainerExcl.prototype._computeImplicitDur = function (earliest_end, latest_end, hasResolvedChild) {
	/**
	* compute the implicit duration with endsync semantics or defaults
	* 1. if excl has no child with definite begin, then its implicit duration is 0
	* 2. otherwise, it follows the semantics of endsync, being 'last' the default
	*/
	if (hasResolvedChild && this._attrs['endsync'] !== undefined) {
		if (/first/i.test(this._attrs['endsync']['value']))
			this._implicit_dur = earliest_end;
		else if (/last/i.test(this._attrs['endsync']['value'])) {
			this._implicit_dur = latest_end;
		} else if (/^((?:\w|\d)+)/.test(this._attrs['endsync']['value'])) {
			// identifier
			// FIXME: we must make sure that the identifier is a child of the 
			// this container
			var dom_node = this._attrs['endsync']['dom'];
			var target_res = $(dom_node.ownerDocument).find('#' + this._attrs['endsync']['value']);

			if (target_res.length > 0) {
				var dom_node = target_res.get(0);
				var tg_node = $(dom_node).data('timegraph_node');

				if (tg_node._parent === this)
					this._implicit_dur = tg_node._active_interval.end;
				else
					this._implicit_dur = latest_end;
			} else 
				this._implicit_dur = latest_end;
		}
	} else if (hasResolvedChild && this._attrs['endsync'] == undefined)
		this._implicit_dur = latest_end;
	else
		this._implicit_dur = 0;
};

TimeContainerExcl.prototype.computeTiming = function () {
	/**
	* compute the schedule of an excl time container
	* - notice that priority class semantics is not supported
	* the temporal semantics is similar to par but only one child should be 
	* active any time
	*/
	var earliest_end = Infinity;
	var latest_end = 0;
	var hasResolvedChild = false;

	// compute implicit duration and temporal layout
	for (var i = 0; i < this._children.length; i++) {
		var child = this._children[i];

		child.computeTiming();
		if (child._active_interval.begin < Infinity) {
			if (child._active_interval.end > latest_end)
				latest_end = child._active_interval.end;
			if (child._active_interval.end < earliest_end)
				earliest_end = child._active_interval.end;
			hasResolvedChild = true;
		}
		this._child_cache[child._node_id] = {
			begin: child._active_interval.begin, 
			end: child._active_interval.end, 
			visited: false
		};
	}
	// compute the active interval
	this._buildSchedule();
	this._computeImplicitDur(earliest_end, latest_end, hasResolvedChild);
	TimeContainerExcl._superClass.computeTiming.call(this);
	$(this).trigger('timing_ready');
};

TimeContainerExcl.prototype.updateTiming = function (affected_node) {
	/**
	* compute the container schedule without recursing to the children
	* - check if any child has been modified
	* - update the schedule as needed
	*/
	var children = this._children;
	var reschedule = false;
	var hasResolvedChild = false;
	var latest_end = 0;
	var earliest_end = Infinity;

	for (var i = 0; i < children.length; i++) {
		var child = children[i];
		var ce = this._child_cache[child._node_id];

		// check if the timing of any child has changed
		if (ce.begin != child._active_interval.begin || 
			ce.end != child._active_interval.end) {
			ce.begin = child._active_interval.begin;
			ce.end = child._active_interval.end;
			ce.visited = false; // allow the child to enter the schedule
			reschedule = true;
		}
		// check if child is resolved
		if (child._active_interval.begin < Infinity) {
			if (child._active_interval.end > latest_end)
				latest_end = child._active_interval.end;
			if (child._active_interval.end < earliest_end)
				earliest_end = child._active_interval.end;
			hasResolvedChild = true;
		}
	}
	if (reschedule)
		this._buildSchedule();
	this._computeImplicitDur(earliest_end, latest_end, hasResolvedChild);
	TimeContainerExcl._superClass.computeTiming.call(this);
	if (this._parent !== null)
		this._parent.updateTiming(this);
};

TimeContainerExcl.prototype._reset = function () {
	/**
	* reset children, restore indeterminate scheduling points and recompute
	*/
	var earliest_point = Infinity;

	for (var i = 0; i < this._children.length; i++) {
		var child = this._children[i];

		if (!child.isIdle())
			child._reset();
	}
	this._buildSchedule();
	this._implicit_dur = 0;
	TimeContainerExcl._superClass._reset.call(this);
};

TimeContainerExcl.prototype.update = function () {
	/**
	* sampling of excl: requires an interrupt dynamics, because  when no child 
	* is scheduled the implicit duration is zero and it can change with another
	* child
	*/
	var time = this.parentToLocal();
	// choose the current child according to the schedule
	if (this._pq.size() > 0 && time >= this._pq.min()._pri) {
		// case 1: another child is scheduled
		// replace the child and incrementally update the schedule
		if (this._active_child !== null)
			this._active_child.deactivate();
		this._active_child = this._pq.dequeue()._value;
		this.updateTiming();
		this._child_cache[this._active_child._node_id].visited = true;
		this._active_child.activate();
	} else if (this._active_child !== null && 
		time >= this._active_child.end) {
		// case 2: current child has finished
		this._active_child.deactivate();
		this._active_child = null;
	}
	TimeContainerExcl._superClass.update.call(this);
	if (this._active_child !== null)
		this._active_child.update();

};

// TODO: design test cases for this
TimeContainerExcl.prototype.seek = function () {
	/**
	* seeking an excl time container involves seeking an appropriate offset 
	* in the active child;
	* - if a seek is backward, then it is possible that some consumed schedule
	*   should act; consequently, the schedule must be rebuilt
	*/
	var cur = null;

	TimeContainerExcl._superClass.seek.call(this);
	// rebuild the schedule and select the child that should be the current
	this._buildSchedule();
	while (this._pq.size() > 0 && this._time >= this._pq.min()._pri) {
		cur = this._pq.dequeue()._value;
	}
	if (cur !== null && cur !== this._active_child) {
		// case 1: a new child should be the current, replace it
		if (this._active_child !== null)
			this._active_child.deactivate(true);
		this._active_child = cur;
		this.updateTiming();
		this._active_child.activate();
	} else if (cur !== null && cur === this._active_child && 
		this._time >= cur._active_interval.end) {
		// case 2: cur child is the same, but expired
		// deactivate the child without raising event
		this._active_child.deactivate(true);
		this.updateTiming();
		this._active_child = null;
	}
	if (this._active_child !== null && this._active_child.isActive())
		this._active_child.seek();
};

TimeContainerExcl.prototype.activate = function () {
	if (this.isActive())
		return;
	logger.debug('begin on', this, this._node_id);
	TimeContainerExcl._superClass.activate.call(this);
	$(this).trigger('beginEvent', {'node_id': this._node_id});
};

TimeContainerExcl.prototype.deactivate = function (skip_event) {
	if (!this.isActive())
		return;
	TimeContainerExcl._superClass.deactivate.call(this, skip_event);
	logger.debug('end on', this, this._node_id);
	if (!skip_event)
		$(this).trigger('endEvent', {'node_id': this._node_id});
	else
		logger.debug('endEvent for', this, this._node_id, 'skipped');
};

TimeContainerExcl.prototype.getType = function () {
	return 'excl';
};

function DiscreteMediaElement(__node_id, __target_node) {
	/**
	* blindly aswers to playback commands
	*/
	TimeElement.call(this, __node_id, __target_node);
	
	this._implicit_dur = 0;
}

ACTIVETIMESHEETS.util.inherits(TimeElement, DiscreteMediaElement);

DiscreteMediaElement.prototype.getType = function () {
	return 'dm';
};

DiscreteMediaElement.prototype.activate = function () {
	if (this.isActive())
		return;
	DiscreteMediaElement._superClass.activate.call(this)
	$(this).trigger('beginEvent', {'node_id': this._node_id});
	logger.debug('begin on', this, 'id:', this._node_id);
};

DiscreteMediaElement.prototype.deactivate = function (skip_event) {
	if (!this.isActive())
		return;
	DiscreteMediaElement._superClass.deactivate.call(this)
	logger.debug('end on', this, 'id:', this._node_id);
	if (!skip_event)
		$(this).trigger('endEvent', {'node_id': this._node_id});
	else
		logger.debug('endEvent for', this, this._node_id, 'skipped');
};

function HTMLContinuousMediaElement(__node_id, __target_node) {
	/**
	* Wrapper for HTMLMediaElement. 
	* Features: 
	* - manages notification of explicit timing 
	* - enforces clipping
	*/
	TimeElement.call(this, __node_id, __target_node);

	this._SYNC_THRESHOLD = .5; // experimentally defined (in seconds)
}

ACTIVETIMESHEETS.util.inherits(TimeElement, HTMLContinuousMediaElement);

HTMLContinuousMediaElement.prototype._bindEvents = function() {
	var self = this;
	var target = this._target_node;
	var progress_ev = 'progress.' + this._node_id;
	var waiting_ev = 'buffering.' + this._node_id;
	var metadata_ev = 'loadedmetadata.' + this._node_id;
	var seeking_ev = 'seeking.' + this._node_id;
	var seeked_ev = 'seeked.' + this._node_id;

	var isBuffered = function () {
		var buffered = false;
		var now = target.currentTime;
		var ranges = [];

		for (var i = 0; i < target.buffered.length; i++) {
			var start = target.buffered.start(i);
			var end = target.buffered.end(i);

			ranges.push('[' + start + ',' + end + ']');
			if (now >= start && now <= end)
				buffered = true;
		}

		return buffered;
	};

	HTMLContinuousMediaElement._superClass._bindEvents.call(this);

	/**
	* register stalling conditions, which are any or both of: 
	* - seeking;
	* - buffer underun
	*/ 
	$(target).bind(progress_ev, function () {
		// FIXME: this buffering strategy is too conservative and it is making
		// the presentation pause too much
		if (self._state == 'playing' && !isBuffered())
			$(this).trigger(waiting_ev);
	});
	$(target).bind(seeking_ev, function () {
		if ($(this).data('syncing')) {
			// do nothing
		} else if (self._state == 'playing') {
			logger.debug('seeking for', self, self._node_id, 'ongoing...');
			self._state = 'stalled';
			if (presentation !== null)
				presentation.suspend();
			flags.stalled_media_items++;
		}
	});
	$(target).bind(seeked_ev, function () {
		if (self._state == 'stalled') {
			self._state = 'playing';
			if (presentation !== null)
				presentation.resume();
			flags.stalled_media_items--;
			logger.debug('seeking for', self, self._node_id, 'finished...');
		}
	});
	$(target).bind(waiting_ev, function () {
		/*
		* if playback has stalled, propagate the state to the timegraph
		*/
		var timer_id = null;

		logger.debug('buffering for', self, self._node_id, 'ongoing...');
		if (flags.stalled_media_items == 0 && presentation !== null) {
			presentation.suspend();
		}
		self._state = 'stalled';
		flags.stalled_media_items++;
		timer_id = setInterval(function () {
			// monitor for media state change
			if (isBuffered()) {
				logger.debug('buffering for', self, self._node_id, 'finished');
				if (flags.stalled_media_items > 0)
					flags.stalled_media_items--;
				self._state = 'playing';
				if (flags.stalled_media_items == 0 && presentation !== null) {
					presentation.resume();
				}
				clearInterval(timer_id);
			}
		}, 100);
	});

	this._event_handlers[waiting_ev] = target;
	this._event_handlers[progress_ev] = target;
	this._event_handlers[seeking_ev] = target;
	this._event_handlers[seeked_ev] = target;
};

HTMLContinuousMediaElement.prototype.update = function() {
	HTMLContinuousMediaElement._superClass.update.call(this);
	if (!this._target_node.paused && this._state == 'frozen')
		this._target_node.pause();
	else if (this._target_node.paused && this._state == 'playing')
		this._target_node.play();
	this._target_node.playbackRate = this.getCascadedSpeed();
	this._target_node.volume = this.getCascadedVolume();
};

HTMLContinuousMediaElement.prototype._checkSyncError = function() {
	/**
	* check if there is a sync error in the media element 
	* and attempt to correct by synchronizing the internal timer 
	* to the media element
	*/
	var target = this._target_node;
	var self = this;

	if ($(target).data('syncing')) {
		// do nothing
	} else if (this._state == 'playing') {
		var media_time = target.currentTime;
		var local_time = this._time;
		
		if (Math.abs(media_time - local_time) >= this._SYNC_THRESHOLD) {
			$(target).bind('seeked.correction', function (ev) {
				logger.debug('sync error corrected on', self, self._node_id);
				$(this).data('syncing', false);
				$(this).unbind(ev);
			});
			$(target).data('syncing', true);
			target.currentTime = local_time;
		}
	}
};

HTMLContinuousMediaElement.prototype.computeTiming = function () {
	var self = this;
	var target = this._target_node;

	if (target.readyState > 0)
		this._implicit_dur = this._target_node.duration;
	HTMLContinuousMediaElement._superClass.computeTiming.call(this);
	if (target.readyState > 0)
		this._target_node.currentTime = this._time;
};

HTMLContinuousMediaElement.prototype._reset = function () {
	HTMLContinuousMediaElement._superClass._reset.call(this);
	this._target_node.currentTime = 0;
};

HTMLContinuousMediaElement.prototype.pause = function () {
	if (this.isPlaying()) {
		HTMLContinuousMediaElement._superClass.pause.call(this);
		this._target_node.pause();
	}
};

HTMLContinuousMediaElement.prototype.play = function () {
	if (this.isPaused()) {
		HTMLContinuousMediaElement._superClass.play.call(this);
		this._target_node.play();
	}
};

HTMLContinuousMediaElement.prototype.seek = function () {
	/**
	* a seek operation started at some ancestor and propagated down 
	* to this element. 
	*/
	HTMLContinuousMediaElement._superClass.seek.call(this);
	if (this._target_node.readyState > 0) {
		this._target_node.currentTime = this._time;
	} 
};

HTMLContinuousMediaElement.prototype.activate = function () {
	if (this.isActive())
		return;

	var self = this;

	$(this._target_node).bind('timeupdate.syncerror', function () {
		self._checkSyncError();
	});

	HTMLContinuousMediaElement._superClass.activate.call(this);
	if (this._target_node.readyState > 0)
		this._target_node.currentTime = this._clipped_interval.begin;
	this._target_node.play();
	$(this).trigger('beginEvent', {'node_id': this._node_id});
	logger.debug('begin on', this, 'id:', this._node_id);
};

HTMLContinuousMediaElement.prototype.deactivate = function (skip_event) {
	if (!this.isActive())
		return;

	var self = this;

	$(this._target_node).unbind('timeupdate.syncerror');
	HTMLContinuousMediaElement._superClass.deactivate.call(this);
	// XXX: apparently when ended=true, then the video refuses to rewind
	// thw worse is that it's not deterministic
	this._target_node.pause();
	this._target_node.currentTime = this._clipped_interval.begin;
	logger.debug('end on', this, 'id:', this._node_id);
	if (!skip_event)
		$(this).trigger('endEvent', {'node_id': this._node_id});
	else
		logger.debug('endEvent for', this, this._node_id, 'skipped');
};


HTMLContinuousMediaElement.prototype.getType = function () {
	return 'cm';
};

function YouTubeMediaElement(__node_id, __target_node, __yt_player) {
	/**
	* Wrapper for a YouTube video
	*/
	this._yt_player = __yt_player;
	this._yt_player.isPaused = function () {
		return this.getPlayerState() == YT.PlayerState.PAUSED;
	};
	TimeElement.call(this, __node_id, __target_node);
}

ACTIVETIMESHEETS.util.inherits(TimeElement, YouTubeMediaElement);

YouTubeMediaElement.prototype._bindEvents = function () {
	/**
	* handlers for the state machine of a youtube player
	*/ 
	var stateChangeEv = 'yt_statechange_' + this._node_id;
	var errorEv = 'yt_error_' + this._node_id;
	var self = this;

	window[stateChangeEv] = function (ev) {
		if (ev['data'] == YT.PlayerState.BUFFERING) {
			logger.debug('buffering for', self, self._node_id, 'ongoing...');
			if (flags.stalled_media_items == 0 && presentation !== null) {
				presentation.suspend();
			}
			self._state = 'stalled';
			flags.stalled_media_items++;
		} else if (ev['data'] == YT.PlayerState.PLAYING) {
			if (self._state == 'stalled') {
				logger.debug('buffering for', self, self._node_id, 'finished');
				if (flags.stalled_media_items > 0)
					flags.stalled_media_items--;
				if (presentation !== null)
					presentation.resume();
				self._state = 'playing';
			}
		} else if (ev['data'] == YT.PlayerState.PAUSED) {
			if (self._state == 'stalled') {
				logger.debug('buffering for', self, self._node_id, 'finished');
				if (flags.stalled_media_items > 0)
					flags.stalled_media_items--;
				if (presentation !== null)
					presentation.resume();
				self._state = 'paused';
			}
		}
	};

	window[errorEv] = function (ev) {};

	this._yt_player.addEventListener('onStateChange', stateChangeEv);
	this._yt_player.addEventListener('onError', errorEv);

	this._event_handlers = [];
	this._event_handlers.push(stateChangeEv);
	this._event_handlers.push(errorEv);
};

YouTubeMediaElement.prototype.destroy = function () {
	/**
	* turn all event handlers into no-ops
	*/
	for (var i = 0; i < this._event_handlers.length; i++)
		window[this._event_handlers[i]] = function () {};
};

YouTubeMediaElement.prototype.update = function () {
	var cs = this.getCascadedSpeed();
	var cv = this.getCascadedVolume();

	YouTubeMediaElement._superClass.update.call(this);
	if (this._yt_player.isPaused() && this._state == 'frozen')
		this._yt_player.pauseVideo();
	else if (this._yt_player.isPaused() == YT.PlayerState.PAUSED)
		this._yt_player.playVideo();
	this._yt_player.setPlaybackRate(this.getCascadedSpeed());
	this._yt_player.setVolume(this.getCascadedVolume()*100);
};

YouTubeMediaElement.prototype.computeTiming = function () {
	this._implicit_dur = this._yt_player.getDuration();
	YouTubeMediaElement._superClass.computeTiming.call(this);
	this._yt_player.seekTo(this._time);
};

YouTubeMediaElement.prototype._reset = function () {
	YouTubeMediaElement._superClass._reset.call(this);
	this._yt_player.seekTo(0);
	this._yt_player.stopVideo();
};

YouTubeMediaElement.prototype.pause = function () {
	if (this.isPlaying()) {
		YouTubeMediaElement._superClass.pause.call(this);
		this._yt_player.pauseVideo();
	}
};


YouTubeMediaElement.prototype.play = function () {
	if (this.isPaused()) {
		YouTubeMediaElement._superClass.play.call(this);
		this._yt_player.playVideo();
	}
};

YouTubeMediaElement.prototype.seek = function () {
	YouTubeMediaElement._superClass.seek.call(this);
	this._yt_player.seekTo(this._time);
};

YouTubeMediaElement.prototype.activate = function () {
	if (!this.isActive()) {
		var self = this;
		
		YouTubeMediaElement._superClass.activate.call(this);
		this._yt_player.seekTo(this._clipped_interval.begin);
		this._yt_player.playVideo();
		$(this).trigger('beginEvent', {'node_id': this._node_id});
		logger.debug('begin on', this, 'id:', this._node_id);
	}
};

YouTubeMediaElement.prototype.deactivate = function (skip_event) {
	YouTubeMediaElement._superClass.deactivate.call(this);
	this._yt_player.pauseVideo();
	this._yt_player.seekTo(this._clipped_interval.begin);
	logger.debug('end on', this, 'id:', this._node_id);
	if (!skip_event)
		$(this).trigger('endEvent', {'node_id': this._node_id});
	else
		logger.debug('endEvent for', this, this._node_id, 'skipped');
};

YouTubeMediaElement.prototype.getType = function () {
	return 'yt';
};


/* PUBLIC API */

function PresentationWrapper(__timegraph, __dom_list) {
	/**
	* a wrapper to avoid exposing the timegraph, so
	* that it uses references to global data structures;
	* also control the buffering conditions of the timegraph
	*
	*/
	var self = this;

	this._timer = new Timer();
	this._updating = false;
	this._timegraph = __timegraph;
	this._dom_list = __dom_list;
	this._timerate = 40;
	this._timer_id = null;
	this._state = 'idle'; // 'idle' || 'suspended' || 'playing' || 'paused' || 'stopped'

	this.play = function () {
		if (this.isSuspended())
			return;
		if (this.isPaused()) {
			logger.timer.play();
			this._registerTimerUpdate();
			this._timer.play();
			this._timegraph.play();
			this._state = 'playing';
			logger.debug('presentation playing from paused');
		} else if (this.isIdle() || this.isStopped()) {
			logger.timer.play();
			this._registerTimerUpdate();
			this._timer.play();
			this._state = 'playing';
			this._timegraph.activate();
			logger.debug('presentation playing from idle');
		}
	};

	this._registerTimerUpdate = function () {
		this._timer_id = setInterval(function () {
			self._update();
		}, this._timerate);
	};

	this._unregisterTimerUpdate = function () {
		clearInterval(this._timer_id);
	};

	this.pause = function () {
		if (this.isPlaying()) {
			logger.timer.pause();
			this._unregisterTimerUpdate();
			this._timer.pause();
			this._timegraph.pause();
			this._state = 'paused';
			logger.debug('presentation paused');
		}
	};

	this.suspend = function () {
		if (this.isPlaying()) {
			this.pause();
			this._state = 'suspended';
			$(this).trigger('suspended');
			logger.debug('presentation suspended');
		}
	};

	this.resume = function () {
		if (this.isSuspended()) {
			this._state = 'playing';
			this.play();
			$(this).trigger('resumed');
			logger.debug('presentation resumed');
		}
	};

	this.stop = function () {
		logger.timer.stop();
		this._unregisterTimerUpdate();
		this._timer.stop();
		this._timegraph.deactivate();
		this._state = 'stopped';
		logger.debug('presentation stopped');
	};

	this._update = function () {
		/**
		* trigger an update in the timegraph, in case one is not already 
		* in course. This operation should be triggered by the timer
		*/
		if (!this._updating) {
			this._updating = true;
			this._timegraph.setTime(self._timer.getTime());
			this._timegraph.update();
			this._updating = false;
		}
	};

	this._seek = function (time) {
		/**
		* - update the timer
		* - change the state of the timegraph
		* - change the time of the timegraph
		* - notify the seek operation
		*/
		this._updating = true;
		if (!(this._timegraph.isStalled() || this.isSuspended())) {
			if (this.isIdle()) {
				logger.timer.play();
				this._timer.play();
				this._timer.setTime(time);
				this._timegraph.setTime(time);
				this._timegraph.activate();
				this._timegraph.seek();
				// this._timegraph.update();
				this._registerTimerUpdate();
			} else if (this.isPaused()) {
				logger.timer.play();
				this._timer.play();
				this._timer.setTime(time);
				this._timegraph.setTime(time);
				this._timegraph.seek();
				// this._timegraph.update();
				this._timegraph.play();
				this._registerTimerUpdate();
			} else if (this.isPlaying()) {
				this._timer.setTime(time);
				this._timegraph.setTime(time);
				this._timegraph.seek();
				// this._timegraph.update();
			}
		}
		this._updating = false;
	};

	this.isPaused = function () {
		return this._state == 'paused';
	};

	this.isPlaying = function () {
		return this._state == 'playing';
	};

	this.isSuspended = function () {
		return this._state == 'suspended';
	};

	this.isIdle = function () {
		return this._state == 'idle';
	};

	this.isStopped = function () {
		return this._state == 'stopped';
	};

	this.getTime = function () {
		return this._timer.getTime();
	};

	this.getDuration = function () {
		return this._timegraph.getDur();
	};

	this.getNodeInternalDuration = function (node_id) {
		var ts = this.getExternalDOM().getTimesheetElement();
		var root = ts.find('#' + node_id);
		var res = Infinity;

		if (root.length > 0) {
			res = root[0].getTimegraphNode().getInternalDur();
		}

		return res;
	};

	this.formatTimegraph = function (include_timing) {
		return formatter.toHierarchyStr(this._timegraph, include_timing);
	};

	this.getExternalDOM = function (index) {
		var i = (index >= 0 && this._dom_list['external'].length > 0) ? index : 0;

		return this._dom_list['external'][i];
	};

	this._reset = function () {
		$(document).unbind('smil_stalled');
		$(document).unbind('smil_can_play');
		$(this._timegraph).unbind('beginEvent');
		$(this._timegraph).unbind('playing');
		$(this._timegraph).unbind('paused');
		$(this._timegraph).unbind('endEvent');
		$(this._timegraph).unbind('duration_changed');
	};

	this._configure = function () {
		$(document).bind('smil_stalled', function () {
			self._timegraph.pause();
			$(self).trigger('stalled');
		});
		$(document).bind('smil_can_play', function () {
			self._timegraph.play();
			$(self).trigger('canplay');
		});
		$(this._timegraph).bind('beginEvent', function () {
			$(self).trigger('started');
		});
		$(this._timegraph).bind('playing', function () {
			$(self).trigger('playing');
		});
		$(this._timegraph).bind('paused', function () {
			$(self).trigger('paused');
		});
		$(this._timegraph).bind('endEvent', function (ev, data) {
			logger.timer.stop();
			self._unregisterTimerUpdate();
			self._timer.stop();
			$(self).trigger('stopped');
			logger.debug('timegraph ended', self.formatTimegraph());
		});
		$(this._timegraph).bind('duration_changed', function (ev) {
			$(self).trigger('duration_changed');
			logger.debug('timegraph duration changed');
		});

		// register the wrapper in the timegraph
		this._timegraph._presentation = this;
	};

	this.restart = function (timegraph, dom_list) {
		/**
		* restart the presentation with a new timegraph
		*/
		this._reset();
		this._timegraph = timegraph;
		this._dom_list = dom_list;
		this._configure();
	};

	/* constructor */
	this._configure();
};

exports.start = function (_logger) {
	/**
	* setup the SMIL timesheets engine. It should be called once the
	* document with the spatial formatting is loaded (preferably on the
	* $.ready() event of the main page)
	*/

	var parser = new Parser();

	reset();
	logger = new TimedLogger(_logger);
	MediaFragments.setLogger(logger);
	// logger = _logger || new ACTIVETIMESHEETS.util.Logger('debug', 
	// 	new InternalTimer());
	bindEvents();
	$(parser).bind('timegraph_ready', function (ev, data) {
		var timegraph = data['timegraph'];
		var dom_list = data['dom_list'];

		if (timegraph !== null) {
			presentation = new PresentationWrapper(timegraph, dom_list);
			logger.debug('presentation ready. Waiting for playback commands...');
			$(ACTIVETIMESHEETS.engine).trigger('presentation_ready');
		}
		$(this).unbind(ev);
	});
	
	parser.parse();
};

exports.restart = function() {
	var parser = new Parser();

	reset();
	logger.debug('restarting presentation...');
	$(parser).bind('timegraph_ready', function (ev, data) {
		var timegraph = data['timegraph'];
		var dom_list = data['dom_list'];

		if (timegraph !== null) {
			presentation.restart(timegraph, dom_list);
			logger.debug('presentation ready. Waiting for playback commands...');
			$(ACTIVETIMESHEETS.engine).trigger('presentation_restarted');
		}
		$(this).unbind(ev);
	});
	parser.parse();
};

exports.getPresentation = function () {
	return presentation;
};

exports._getLogger = function () {
	return logger;
};

return exports;

})(jQuery); /* end module */