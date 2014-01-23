/*global define, $*/

define(function (require) {
  var Graph         = require('lab-grapher'),
      metadata      = require('common/controllers/interactive-metadata'),
      validator     = require('common/validator'),
      ListeningPool = require('common/listening-pool'),
      DataSet       = require('common/controllers/data-set'),

      // Note: We always explicitly copy properties from component spec to grapher options hash,
      // in order to avoid tighly coupling an externally-exposed API (the component spec) to an
      // internal implementation detail (the grapher options format).
      grapherOptionForComponentSpecProperty = {
        title: 'title',
        enableAutoScaleButton: 'enableAutoScaleButton',
        enableAxisScaling: 'enableAxisScaling',
        enableSelectionButton: 'enableSelectionButton',
        clearSelectionOnLeavingSelectMode: 'clearSelectionOnLeavingSelectMode',
        dataPoints: 'dataPoints',
        markAllDataPoints: 'markAllDataPoints',
        showRulersOnSelection: 'showRulersOnSelection',
        fontScaleRelativeToParent: 'fontScaleRelativeToParent',
        xlabel: 'xlabel',
        xmin: 'xmin',
        xmax: 'xmax',
        ylabel: 'ylabel',
        ymin: 'ymin',
        ymax: 'ymax',
        lineWidth: 'lineWidth',
        xTickCount: 'xTickCount',
        yTickCount: 'yTickCount',
        xscaleExponent: 'xscaleExponent',
        yscaleExponent: 'yscaleExponent',
        xFormatter: 'xFormatter',
        yFormatter: 'yFormatter',
        lines: 'lines',
        bars: 'bars'
      },

      graphControllerCount = 0,

      // Index of the model property whose description sets the current yLabel (when yLabel isn't
      // provided explicitly in graph component description).
      Y_LABEL_PROP_IDX = 0;

  return function graphController(component, interactivesController) {
    var // HTML element containing view
        $container,
        grapher,
        controller,
        dataSet,
        scriptingAPI,
        xProperty,
        properties,
        dataPointsArrays = [],
        staticSeries,
        listeningPool,
        namespace = "graphController" + (++graphControllerCount);

    function getModel () {
      return interactivesController.getModel();
    }

    // Returns true if label is defined explicitly (it's defined and different from "auto").
    function isLabelExplicit(label) {
      return label != null && label !== "auto";
    }

    function loadDataSet () {
      // Get public data set (if its name is provided) or create own, private data set that will
      // be used only by this graph.
      if (component.dataSet) {
        dataSet = interactivesController.getDataSet(component.dataSet);
      } else {
        // Make sure that properties passed to data set include xProperty!
        var dataSetProperties = component.properties.slice();
        if (dataSetProperties.indexOf(xProperty) === -1) {
          dataSetProperties.push(xProperty);
        }
        dataSet = new DataSet({
                                properties:          dataSetProperties,
                                name:                component.id + "-autoDataSet",
                                streamDataFromModel: component.streamDataFromModel,
                                clearOnModelReset:   component.clearOnModelReset
                              }, interactivesController, true);
      }
      listeningPool.listen(dataSet, DataSet.Events.DATA_RESET,        _dataResetHandler);
      listeningPool.listen(dataSet, DataSet.Events.SAMPLE_ADDED,      _sampleAddedHandler);
      listeningPool.listen(dataSet, DataSet.Events.SELECTION_CHANGED, _selectionChangeHandler);
      listeningPool.listen(dataSet, DataSet.Events.DATA_TRUNCATED,    _invalidationHandler);
      listeningPool.listen(dataSet, DataSet.Events.LABELS_CHANGED,    _labelsChangedHandler);
    }

    function initialize() {
      scriptingAPI = interactivesController.getScriptingAPI();
      listeningPool = new ListeningPool(namespace);
      // Validate component definition, use validated copy of the properties.
      component = validator.validateCompleteness(metadata.graph, component);
      // The list of properties we are being asked to graph.
      properties = component.properties.slice();
      xProperty = component.xProperty;
      loadDataSet();
      $container = $('<div>').attr('id', component.id).addClass('graph');
      // Each interactive component has to have class "component".
      $container.addClass("component");
      // Apply custom width and height settings.
      $container.css({
        width: component.width,
        height: component.height
      });
      if (component.tooltip) {
        $container.attr("title", component.tooltip);
      }

      staticSeries = [];

      // Initial setup of the data.
      dataSet.resetData();
    }

    /**
      Return an options hash for use by the grapher.
    */
    function getOptions() {
      var options = {},
          cProp,
          gOption;

      // update grapher options from component spec & defaults
      for (cProp in grapherOptionForComponentSpecProperty) {
        if (grapherOptionForComponentSpecProperty.hasOwnProperty(cProp)) {
          gOption = grapherOptionForComponentSpecProperty[cProp];
          options[gOption] = component[cProp];
        }
      }
      return options;
    }

    /**
      Causes the graph to move the "current" pointer to the current model step. This desaturates
      the graph region corresponding to times after the current point.
    */
    function redrawCurrentStepPointer(step) {
      grapher.updateOrRescale(step);
    }
    function _selectionChangeHandler(evt) {
      redrawCurrentStepPointer(evt.data);  //
    }

    function resetGraph() {
      if (grapher) {
        if (component.resetAxesOnReset) {
          resetGrapher();
        }
      } else {
        initGrapher();
      }
      updateLabels();
    }
    function _modelResetHandler() {
      resetGraph();
    }

    /**
      Reset all the datapoints in the graph.
      dataSeriesArry will contain an empty data set, or invitial values
      for all model params.
    */
    function clearGrapher(data) {
      if (!grapher) return;
      // Convert data received from data set to data format expected by grapher (nested arrays).
      var gData = [];
      var gSeries;
      var xArr;
      var propArr;
      properties.forEach(function (prop) {
        gSeries = [];
        xArr = data[xProperty];
        propArr = data[prop];
        for (var i = 0, len = Math.min(xArr.length, propArr.length); i < len; i++) {
          gSeries.push([xArr[i], propArr[i]]);
        }
        gData.push(gSeries);
      });

      // Append static data series!
      gData = gData.concat(staticSeries);

      grapher.resetPoints(gData);
      grapher.repaint();
    }

    function _dataResetHandler(extra) {
      clearGrapher(extra.data);
    }
    function _invalidationHandler(extra) {
      clearGrapher(extra.data);
    }
    function _labelsChangedHandler(labels) {
      // Set label provided by dataset only if graph component description doesn't specify ylabel.
      var yLabel = labels[properties[Y_LABEL_PROP_IDX]];
      var xLabel = labels[component.xProperty];
      if (!isLabelExplicit(component.ylabel) && yLabel) {
        grapher.yLabel(yLabel);
      }
      if (!isLabelExplicit(component.xlabel) && xLabel) {
        grapher.xLabel(xLabel);
      }
    }

    /**
      Ask the grapher to reset itself, without adding new data.
    */
    function resetGrapher() {
      grapher.reset('#' + component.id, getOptions());
    }

    /**
      Add new points to the graphers
    */
    function addGraphPoints(dataPoint) {
      if (!grapher) return;
      // Convert data received from data set to data expected by grapher (nested arrays).
      var gPoints = [];
      var point;
      properties.forEach(function (prop) {
        point = [dataPoint[xProperty], dataPoint[prop]];
        gPoints.push(point);
      });
      grapher.addPoints(gPoints);
    }

    function _sampleAddedHandler(evt) {
      addGraphPoints(evt.data);
    }


    function registerModelListeners() {
      var model = getModel();
      // We reset the graph view after model reset.
      model.on('reset', _modelResetHandler);
    }

    function updateLabels() {
      _labelsChangedHandler(dataSet.getLabels());
    }

    function initGrapher() {
      grapher = new Graph($container[0], getOptions(), undefined, interactivesController.getNextTabIndex());
    }

    controller = {
      type: "graph",

      /**
        Called by the interactives controller when the model finishes loading.
      */
      modelLoadedCallback: function() {
        registerModelListeners();
        if (!grapher) {
          initGrapher();
        }
        scriptingAPI = interactivesController.getScriptingAPI();
        updateLabels();
        grapher.repaint();
      },

      getDataSet: function() {
        return dataSet;
      },

      /**
        Used when manually adding points to the graph.
      */
      appendDataPropertiesToComponent: function() {
        dataSet.appendDataPoint(arguments);
      },


      /**
        Add non-realtime series to the dataSet.
      */
      addDataSet: function (series) {
        staticSeries.push(series);
      },

      /**
        Remove all non-realtime data series from the dataSets
      */
      clearDataSets: function () {
        staticSeries = [];
      },

      /**
        Modifies the current list of graph options with new values and resets the graph.the
        Note: does not support changes to the 'properties' list.
      */
      setAttributes: function(opts) {
        if (grapher) {
          $.extend(component, opts);
          dataSet.resetData();
          if (opts.dataPoints) {
            dataPointsArrays = opts.dataPoints;
          }
          resetGrapher();
          // We may have set or unset the explicit 'ylabel' / 'xlabel' options; update the graph's
          // labels as appropriate.
          updateLabels();
        }
      },

      /**
        Adjusts axis ranges to match those of the properties the graph is reading from, without
        clearing data.

        Does nothing to the x-axis if the description of the xProperty has no min or max property.
        For the y-axis properties, finds the (min, max) pair that contains all property ranges,
        ignoring missing values for min or max, as long as at least one property has a min and one
        property has a max.
      */
      syncAxisRangesToPropertyRanges: function() {
        var model = getModel();
        var xDescription = model.getPropertyDescription(component.xProperty);
        var yDescriptions = properties.map(function(property) {
          return model.getPropertyDescription(property);
        });
        var ymin;
        var ymax;

        if (xDescription && xDescription.getMin() != null && xDescription.getMax() != null) {
          grapher.xDomain([xDescription.getMin(), xDescription.getMax()]);
        }

        ymin = Infinity;
        ymax = -Infinity;
        yDescriptions.forEach(function(description) {
          if (description) {
            if (description.getMin() < ymin) ymin = description.getMin();
            if (description.getMax() > ymax) ymax = description.getMax();
          }
        });

        if (isFinite(ymin) && isFinite(ymax)) {
          grapher.yDomain([ymin, ymax]);
        }
      },

      /**
        If the x=0 is not visible in the current x axis range, move the x-axis so that x=0 is
        present at the left of the graph, while keeping the current x axis scale and the y axis
        range.
      */
      scrollXAxisToZero: function() {
        var xmin = grapher.xmin();
        var xmax = grapher.xmax();

        if (xmin !== 0) {
          grapher.xDomain([0, xmax - xmin]);
        }
      },

      /**
        Returns the grapher object itself.
      */
      getView: function() {
        return grapher;
      },

      /**
        Returns a jQuery selection containing the div which contains the graph.
      */
      getViewContainer: function() {
        return $container;
      },

      resize: function () {
        // For now only "fit to parent" behavior is supported.
        if (grapher) {
          grapher.resize();
        }
      },

      reset: function () {
        if (grapher) {
          resetGrapher();
        }
      },

      update: function () {
        if (grapher) {
          grapher.update();
        }
      },

      selectionDomain: function() {
        if (grapher) {
          return grapher.selectionDomain.apply(grapher, arguments);
        }
        return null;
      },

      selectionEnabled: function() {
        if (grapher) {
          return grapher.selectionEnabled.apply(grapher, arguments);
        }
        return null;
      },

      /**
        Returns serialized component definition.
      */
      serialize: function () {
        // The only thing which needs to be updated is scaling of axes.
        // Note however that the serialized definition should always have
        // 'xmin' set to initial value, as after deserialization we assume
        // that there is no previous data and simulations should start from the beginning.
        var result = $.extend(true, {}, component),
            // Get current domains settings, e.g. after dragging performed by the user.
            // TODO: this should be reflected somehow in the grapher model,
            // not grabbed directly from the view as now. Waiting for refactoring.
            xDomain = grapher.xDomain(),
            yDomain = grapher.yDomain(),
            startX  = component.xmin;

        result.ymin = yDomain[0];
        result.ymax = yDomain[1];
        // Shift graph back to the original origin, but keep scale of the X axis.
        // This is not very clear, but follows the rule of least surprise for the user.
        result.xmin = startX;
        result.xmax = startX + xDomain[1] - xDomain[0];

        return result;
      }
    };

    initialize();
    return controller;

  };
});
