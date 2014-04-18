function Logger(mode) {
	/**
	* a logger with optional storage facilities:
	* - in cached mode, messages is flushed in batches
	* - in normal mode, messages are flushed right away
	* - both modes can used simultaneously
	**/
	this.mode = mode || 'info'; // debug | info | error | warn

	function prepare_args(args) {
		var message_array = [];
		for (var i = 0; i < args.length; i++) {
			var str = '';
			if (args[i] !== null && typeof(args[i]) == 'object')
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

	this.enableCache = function () {
		// dumb for activetimesheets
	};

	this.disableCache = function () {
		// dumb for activetimesheets
	};

	this.setMode = function (_mode) {
		this.mode = _mode;
	};
	
	if (console !== undefined) {
		this.debug = function () {
			if (this.mode == 'debug') {
				var msg = "DEBUG: " + prepare_args(arguments);

				console.debug(msg);
			}
		};

		this.error = function () {
			if (this.mode == 'info' || this.mode == 'debug') {
				var msg = "ERROR: " + prepare_args(arguments);

				console.error(msg);
			}
		};

		this.warn = function () {
			if (this.mode == 'warn' || this.mode == 'debug') {
				var msg = "WARN: " + prepare_args(arguments);

				console.warn(msg);
			}
		};

		this.info = function () {
			if (this.mode == 'info' || this.mode == 'debug') {
				var msg = "INFO: " + prepare_args(arguments);

				console.info(msg);
			}
		};
	} else {
		this.debug = function () {};
		this.error = function () {};
		this.warn = function () {};
		this.info = function () {};
	}
}