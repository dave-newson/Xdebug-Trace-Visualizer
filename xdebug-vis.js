$(function () {

    var levelBounds = { low: Number.POSITIVE_INFINITY, high: Number.NEGATIVE_INFINITY },
        timeBounds = { low: Number.POSITIVE_INFINITY, high: Number.NEGATIVE_INFINITY },
        memoryBounds = { low: Number.POSITIVE_INFINITY, high: Number.NEGATIVE_INFINITY }
        localMemoryBounds = { high: Number.NEGATIVE_INFINITY };

    var $status = $('#status');
    var frozenCall = null,
        frozenNode = null;

    function Call() {
        this.internals = [];
    }

    $.extend(Call.prototype, {
        setStart: function (fields) {
            this.level = +fields[0];
            levelBounds.low = Math.min(levelBounds.low, this.level);
            levelBounds.high = Math.max(levelBounds.high, this.level);

            this.functionNumber = +fields[1];

            this.timeIndex = { start: +fields[3] };
            timeBounds.low = Math.min(timeBounds.low, this.timeIndex.start);

            this.memoryUsage = { start: +fields[4] };
            memoryBounds.low = Math.min(memoryBounds.low, this.memoryUsage.start);
            memoryBounds.high = Math.max(memoryBounds.high, this.memoryUsage.start);

            this.functionName = fields[5];
            this.userDefined = fields[6] === '1';
            this.includeRequireFile = fields[7];
            this.fileName = fields[8];
            this.lineNumber = +fields[9];
            this.optionalParameters = fields.slice(11);
        },
        /**
         * Adds an internal function call
         */
        addInternal: function (line) {
            this.internals.push(line);
        },
        setEnd: function (fields) {
            this.timeIndex.end = +fields[3];
            timeBounds.high = Math.max(timeBounds.high, this.timeIndex.end);
            
            this.memoryUsage.end = +fields[4];
            memoryBounds.low = Math.min(memoryBounds.low, this.memoryUsage.end);
            memoryBounds.high = Math.max(memoryBounds.high, this.memoryUsage.end);
            
            var internalCalls = this.internals;
            delete this.internals;
            this.calls = getCalls(internalCalls);

            // Traverse children and subtract child memory alloc from this alloc.
            debugger;
        }
    });

    /**
     * Represents the full xdebug trace file
     */
    function Trace(traceStr) {
        this.calls = getCalls(traceStr.split(/\r\n|\r|\n/g));
        this.stackBounds = levelBounds;
        this.timeBounds = timeBounds;
        this.memoryBounds = memoryBounds;
    }

    /**
     * Parse xdebug trace lines, and develop the trace stacks
     */
    function getCalls(lines) {
        var calls = [],
            SEEKING = 'seeking',
            MATCHING = 'matching',
            mode = SEEKING,
            line,
            i = 0,
            fields,
            call,
            matchPrefix,
            matchPrefixLength;

        for (; (line = lines[i++]);) {
            if (mode === SEEKING) {

                fields = line.split('\t');
                if (fields.length >= 10) {
                    call = new Call();
                    call.setStart(fields);
                    mode = MATCHING;
                    matchPrefix = call.level + '\t' + call.functionNumber + '\t1\t';
                    matchPrefixLength = matchPrefix.length;
                }

            } else if (mode == MATCHING) {

                if (line.substr(0, matchPrefixLength) === matchPrefix) {
                    call.setEnd(line.split('\t'));
                    calls.push(call);
                    call = undefined;
                    mode = SEEKING;
                } else {
                    call.addInternal(line);
                }

            }
        }
        if (call !== undefined) {
            call.setEnd(lines[i - 4].split('\t'));
            calls.push(call);
        }
        return calls;
    }


    function timePercentage(duration) {
        return duration / (timeBounds.high - timeBounds.low);
    }

    function memoryPercentage(usage) {
        return usage / (memoryBounds.high - memoryBounds.low);
    }


    function Translator() { }
    $.extend(Translator.prototype, {
        setInputCoordinates: function (t, r, b, l) {
            this.inputCoordinates = {
                top: t,
                right: r,
                bottom: b,
                left: l
            };
        },
        setOutputCoordinates: function (t, r, b, l) {
            this.outputCoordinates = {
                top: t,
                right: r,
                bottom: b,
                left: l
            };
        },
        x: function (inputX) {
            return (((inputX - this.inputCoordinates.left) / (this.inputCoordinates.right - this.inputCoordinates.left)) * (this.outputCoordinates.right - this.outputCoordinates.left)) + this.outputCoordinates.left;
        },
        y: function (inputY) {
            return (((inputY - this.inputCoordinates.top) / (this.inputCoordinates.bottom - this.inputCoordinates.top)) * (this.outputCoordinates.bottom - this.outputCoordinates.top)) + this.outputCoordinates.top;
        },
        width: function (inputWidth) {
            return (inputWidth / (this.inputCoordinates.right - this.inputCoordinates.left)) * (this.outputCoordinates.right - this.outputCoordinates.left);
        },
        height: function (inputHeight) {
            return (inputHeight / (this.inputCoordinates.bottom - this.inputCoordinates.top)) * (this.outputCoordinates.bottom - this.outputCoordinates.top);
        }
    });

    /**
     * Clear the statistics panel
     */
    function clear(call) {
        return function () {
            //never clear a frozen call
            if (call === frozenCall) {
                return;
            }
            this.node.style.cssText = '';
            //don't clear the text of a frozen call status
            if (frozenCall) {
                return;
            }
            $status.text('');
        }
    }

    /**
     * Display the statistics of the Call
     */
    function statusFn(call) {
        return function () {
            //don't update the status if we currently have a frozen call
            if (frozenCall) {
                call = frozenCall;
            }
            //console.log(this);
            this.node.style.cssText = 'stroke: #000; stroke-width: 1;';
            var optionalParameters = '';
            if (call.optionalParameters.length) {
                //convert any HTML into text, and display that
                var field_html = $('<span class="optional-parameters"></span>').text(call.optionalParameters.join('\n')).get(0).outerHTML;
                optionalParameters = '<br>' + field_html;
            }

            // Data
            var data = {
                "Function": call.functionName,
                "File": call.fileName,
                "Line": call.lineNumber,
                "Time": ((call.timeIndex.end - call.timeIndex.start) * 1000).toFixed(0) + ' msec',
                "Time %": (timePercentage(call.timeIndex.end - call.timeIndex.start) * 100).toFixed(2),
                "Memory Alloc": ((call.memoryUsage.end - call.memoryUsage.start) / 1024).toFixed(2) + 'Kb',
                "Memory %": (memoryPercentage(call.memoryUsage.end - call.memoryUsage.start) * 100).toFixed(2),
                "Memory Start": (call.memoryUsage.start / 1024).toFixed(2) + 'Kb',
                "Memory End": (call.memoryUsage.end / 1024).toFixed(2) + 'Kb',
                "Parameters": optionalParameters,
            };

            // Render
            $status.html(
                $.map(data, function(value, key) {
                    return key + ": " + value;
                }).join("<br/>")
            );
        };
    }

    /**
     * clicking a call should freeze the status until another call is clicked
     */
    function statusFreeze(call) {
        return function () {
            if (call === frozenCall) {
                //unfreeze the status because we clicked the frozen call again
                frozenCall = null;
            } else {
                var old_call = frozenCall;
                frozenCall = call;
                if (frozenNode) {
                    //clear any previously frozen calls
                    clear(old_call).call(frozenNode);
                }
                frozenNode = this;
                //make sure we show the correct status
                statusFn(call).call(this);
            }
        }
    }

    /**
     * Render the call graph, using the given trace
     */
    function render(trace) {
        var translate = new Translator(),
            $container = $('#flamegraph'),
            outputWidth = $container.width(),
            outputHeight = Math.max($container.height(), 500),
            paper = new Raphael($container[0], outputWidth, outputHeight);

        // Zoom and pan
        var zpd = new RaphaelZPD(paper, { zoom: true, pan: true, drag: false });
        translate.setOutputCoordinates(0, outputWidth, outputHeight, 0);
        translate.setInputCoordinates(trace.stackBounds.high, trace.timeBounds.high, trace.stackBounds.low - 1, trace.timeBounds.low);

        render.calls(paper, trace.calls, translate, $('#render-all').is(':checked'));
    }

    /**
     * Render individual calls
     */
    render.calls = function (paper, calls, translate, render_all) {
        var call,
            i = 0,
            duration_pct,
            memory_pct,
            rect;

        for (; (call = calls[i++]);) {

            duration_pct = timePercentage(call.timeIndex.end - call.timeIndex.start);
            memory_pct = memoryPercentage(call.memoryUsage.end - call.memoryUsage.start) * 10;
            memory_pct = Math.min(1, memory_pct);

            if (!render_all && duration_pct < 0.0008) {
                continue;
            }

            rect = paper.rect(
                translate.x(call.timeIndex.start),
                translate.y(call.level),
                translate.width(call.timeIndex.end - call.timeIndex.start),
                translate.height(-1)
            ).attr({
                fill: 'rgb(' + ((memory_pct) * 100) + '%,' + ((1 - memory_pct) * 100) + '%,0%)'
            }).hover(statusFn(call), clear(call)).click(statusFreeze(call));
            
            $(rect.node).attr('class', call.fileName);
            render.calls(paper, call.calls, translate, render_all);
        }

        $('#header').html('Drag and drop a trace-file here');
    };


    /**
     * Read the trace file
     */
    function read(files) {
        $('#loading').show();
        $('#upload').hide();

        var file = files[0],
            reader = new FileReader();

        reader.addEventListener('loadend', function () {
            $('#loading').hide();

            var trace = new Trace(reader.result);
            render(trace);
        });

        reader.readAsText(file);
    }


    /**
     * Page setup
     */
    $('body')
        .on('dragenter dragover', function (e) {
            e.preventDefault();
            e.stopPropagation();
        })
        .on('drop dragdrop', function (e) {
            if (e.originalEvent.dataTransfer && e.originalEvent.dataTransfer.files.length) {
                e.preventDefault();
                e.stopPropagation();
                read(e.originalEvent.dataTransfer.files);
            }
        });


    $('#loading').hide();

});
