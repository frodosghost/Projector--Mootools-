/**
 * Author: <Gabriel Read> brightblue@pixelcrusher.com
 * 
 * Project: Projector
 * Version: α
 *
 * Description: Projector is (another) slide show plugin that aspires to provide a greater
 * level of design and developmental freedom, while expressing a deeper and richer set of
 * out of the box features.
 * 
 * Features:
 *   - Preloading
 *   - Image and dom element based slides
 *   - Fullscreen slides with automatic scaling and tethering based cropping
 *   - Event based callback support
 *   - Support for multiple concurrent instances
 *   - Easily extended via object apis
*/

var Projector = new Class(
{
  // Inheritance rules
  Implements: [Events],

  // Instance parameters
  _parameters: 
  {
    target: null, // Required: (String || Object) The container or container id. Usually a div, must be a block level element.
    queue:  null, // Optional: (Array) An array of slide objects, see slide class for details. If not present, direct children of the container will be used in place. NB: The queue is accessed using mutators during load and cannot be relied upon as a public data reference.

    preloader:        null,    // Function to use as a preloader animation, called once UI has been setup and executed in the scope of the current instance.
    preload_priority: 'FIRST', // Optional: (String) Specifies the preload and display priority rules.
    
    autoplay: true,        // Optional: (Boolean) If false, manual paging is required to transition between slides. Acts as an state trigger (see appendix).
    pause_on_hover: false, // Optional: (Boolean) If true, will pause the slideshow on mouseover when autoplay is active. Really, both this and pause on change should be the responsibility of the implementer and I don't want this to set precedent for things that shouldn't be Projector's responsibility creeping in, but we'll see.
    pause_on_change: true, // Optional: (Boolean) If false, manual paging will reset, but not stop autoplay.
    shuffle: false,        // Optional: (Boolean) If true will randomize the slide queue prior to load.
    display_duration: 10,  // Optional: (Int) Time is seconds between each transition when autoplay is active.

    transition: 'crossfade', // Optional: (String) Method to use for transitions, must map to a corresponding entry in the ProjectorNS object.
    transition_duration: 1,  // Optional: (Int) Duration in seconds of each transition.
    easing: 'Fx.Transitions.linear', // Optional: (String) Name of a Mootools 'transition' or eaching class to use during transition animations.
    
    fullscreen: false,  // Optional: (Boolean) If true, will force the container to occupy the entire viewport. Acts as an state trigger (see appendix).
    rendering_priority: 'BALANCED', // Optional: (String) Specifies whether to prioritise performance, quality or seek a balance of the two (IE and Firefox only).

    debug: false // Optional: (Boolean) If true will output debugging logs to the console.
  },
  _protected:
  {
    container: null,
    stack: [],
    initiated: null,
    complete: false,
    timeout: null,
    animating: false,
    paused: null,
    active: null
  },

  // Constructor
  initialize: function (parameters)
  {
    // Override default parameters
    this.overrideDefaultParameters(parameters || {});

    // Open up the API
    this.initParameterAPI();

    // Validate parameters
    if (!this.container(new ProjectorNS.Container({ 'target': $(this.target()) })).element())
      throw "The containing element is required but was not passed in or could not be found.";
    if (!this.queue() && this.container().element().getChildren().length === 0)
      throw "The collection of slide objects (stack) was not passed in and the container holds no child elements.";

    // Init UI
    this.initUI();

    // Init lifecycle event chain
    this.initLifecycle();

    // Fetch payloads
    this.load();
    
    // Return instance
    return this;
  },

  overrideDefaultParameters: function (parameters)
  {
    for (var parameter in this._parameters)
    {
      if (typeof parameters[parameter] !== 'undefined')
      {
        this._parameters[parameter] = parameters[parameter];
      }
    }

    return this;
  },

  initParameterAPI: function ()
  {
    var method, parameter;

    for (parameter in Object.merge(this._parameters, this._protected))
    {
      method = parameter.replace(/_[a-z]{1}/g, function ($0) { return $0.substr(-1).toUpperCase(); } );

      if (!this[method])
      {
        this[method] = this.accessor.bind(this, parameter);
      }
    }

    return this;
  },

  accessor: function (parameter, value)
  {
    if (typeof value !== 'undefined')
    {
      this._parameters[parameter.replace(/_[a-z]{1}/g, function($1) { return $1.substr(-1).toUpperCase()})] = value;
    }

    return this._parameters[parameter];
  },

  autoplay: function (value)
  {
    if (typeof value !== 'undefined')
    {
      this._parameters.autoplay = value;

      // Initiate/clear timer on state change.
      if (this._parameters.autoplay)
      {
        this.initTimer();
        this.initPauseOnHover();
      }
      else
      {
        clearTimeout(this.timeout());

        this.container().element().removeEvents('mouseover');
        this.container().element().removeEvents('mouseout');
      }
    }

    return this._parameters.autoplay;
  },

  fullscreen: function (value)
  {
    if (typeof value !== 'undefined')
    {
      this._parameters.fullscreen = value;

      // Reposition and scale on state change.
      this.positionAndScale();
    }

    return this._parameters.fullscreen;
  },

  preloadPriority: function (value)
  {
    if (typeof value !== 'undefined')
    {
      this._parameters.preload_priority = value;
    }

    if (!['FIRST', 'FIRST_LOADED', 'ADJACENT', 'STACK'].contains(this._parameters.preload_priority))
    {
      this.log('Priority rule ' + this._parameters.preload_priority + ' is invalid, switching to FIRST (file).');

      this.preloadPriority('FIRST');
    }

    return this._parameters.preload_priority.toUpperCase();
  },

  renderingPriority: function (value)
  {
    if (typeof value !== 'undefined')
    {
      this._parameters.rendering_priority = value;
    }

    if (!['BALANCED', 'PERFORMANCE', 'QUALITY'].contains(this._parameters.rendering_priority))
    {
      this.log('Rendering priority ' + this._parameters.rendering_priority + ' is invalid, switching to BALANCED.');

      this.renderingPriority('BALANCED');
    }

    return this._parameters.rendering_priority.toUpperCase();
  },

  transition: function (value)
  {
    if (typeof value !== 'undefined')
    {
      this._parameters.transition = value;
    }

    return this._parameters.transition.toLowerCase();
  },

  easing: function (value)
  {
    if (typeof value !== 'undefined')
    {
      this._parameters.easing = value;
    }

    if (this._parameters.easing && typeof this._parameters.easing !== 'function')
    {
      var parts = this._parameters.easing.split('.'), method = window;

      while (parts.length > 0)
      {
        method = method[parts.shift()];
      }

      this._parameters.easing = method;
    }

    return this._parameters.easing;
  },

  initUI: function ()
  {
    this.positionAndScaleContainer();

    if (this.preloader())
    {
      this.preloader().call(this);
    }
    
    return this;
  },

  initLifecycle: function ()
  {
    // Stack has received content
    this.addEvent(ProjectorNS.LOADED, this.auditLoadState.bind(this));

    // Preload conditions satisfied
    this.addEvent(ProjectorNS.READY, this.initDisplay.bind(this));

    // All stack items loaded
    if (this.autoplay())
    {
      this.addEvent(ProjectorNS.COMPLETE, this.initTimer.bind(this));
      this.addEvent(ProjectorNS.COMPLETE, this.initPauseOnHover.bind(this));
    }

    // Transition events
    this.addEvent(ProjectorNS.WILL_TRANSITION_IN, this.positionAndScaleSlide.bind(this));

    // Special case, listen for window.resize events
    window.onresize = function () { this.positionAndScale(); }.bind(this);

    return this;
  },

  load: function ()
  {
    if (!this.queue())
    {
      this.queue(this.container().element().getChildren());
    }

    if (this.shuffle())
    {
      queue = (function (original)
      {
        var array = original;
        for(var j, x, i = array.length; i; j = parseInt(Math.random() * i), x = array[--i], array[i] = array[j], array[j] = x); //Fisher-Yates shuffle algorithm (jsfromhell.com/array/shuffle)
        return array;
      })(this.queue());
    }
    
    switch (this.preloadPriority())
    {
      // First file: Load the first slide independently followed by the remaining files.
      case 'FIRST':
        this.log('Loading using FIRST (file) priority rules.');
        
        this.consume(this.queue(), true);
        
        this.stack().pick().addEvent(ProjectorNS.COMPLETE, function ()
        {
          this.stack().filter(function (slide) { return !slide.complete(); }).each(function (slide)
          {
            slide.load();
          });
        }.bind(this));
        
        this.stack().pick().load();

        break;
      
      // Load the first file in the queue and it's two nearest neighbours, lazy loading remaining files as required.
      case 'ADJACENT':
        this.log('Loading using ADJACENT priority rules.');

        if (this.queue().length > 3)
        {
          this.consume(this.queue().splice(0, 2));

          this.consume(this.queue().splice(0, this.queue().length - 1), true);

          this.push(this.queue().getLast());

          this.addEvent(ProjectorNS.WILL_TRANSITION_IN, function (slide, projector)
          {
            var target_index = this.stack().indexOf(slide) + 1;
            
            if (target_index > 1 && slide !== this.stack().getLast())
            {
              this.at(target_index).load();
            }
          }.bind(this));
        }
        else
        {
          this.log('Insufficient slide count for ADJACENT priority rules, switching to STACK.');

          this.preloadPriority('STACK');

          this.load();
        }

        break;

      // First loaded and stack: load all files at once.
      default:
        this.log('Loading using default priority rules.');

        this.consume(this.queue());

        break;
    }

    return this;
  },

  consume: function (queue, bypass_load)
  {
    queue.each(function (payload)
    {
      this.push(payload, bypass_load);
    }.bind(this));
  },

  push: function (payload, bypass_load)
  {
    var slide, parameters;
    
    // Construct parameter object from the element data
    if ($(payload))
    {
      parameters = { 'target':payload };

      for (var attribute, i=0, attributes=parameters.target.attributes, l=attributes.length; i<l; i++){
        attribute = attributes.item(i);
        if (attribute.nodeName.match(/^data/))
        {
          parameters[attribute.nodeName.replace(/^data-([\-_a-z0-9]+)$/i, '$1').replace(/-/g, '_').toLowerCase()] = attribute.nodeValue;
        }
      }
    }

    // Parameters already passed in as object
    else
    {
      parameters = payload;
    }

    // Global parameters
    Object.merge(parameters,
    {
      rendering_priority: this.renderingPriority(),
      debug: this.debug()
    });

    slide = new ProjectorNS.Slide(parameters);

    slide.addEvent(ProjectorNS.COMPLETE, function ()
    {
      this.fireEvent(ProjectorNS.LOADED, this);
    }.bind(this));

    this.stack().push(bypass_load? slide: slide.load());

    return this;
  },

  auditLoadState: function (event)
  {
    var stack_has_loaded = false, can_display = false;
    
    stack_has_loaded = this.stack().every(function (slide) { return slide.complete(); });

    switch (this.preloadPriority())
    {
      /*
        Adjacent requires the first, second and last slides be loaded for display and as 
        remaining slides are lazy loaded, stack_has_loaded will be set to true also.
      */
      case 'ADJACENT':
        this.log('Auditing using ADJACENT priority rules.');

        stack_has_loaded = can_display = Array.clone(this.stack()).splice(0, 2).every(function (slide) { return slide.complete(); }) && this.stack().getLast() && this.stack().getLast().complete();
        
        break;
      
      /*
        Full stack requires all slides to have complete and therefore has the same 
        requirements as stack_has_loaded.
      */
      case 'STACK':
        this.log('Auditing using STACK priority rules.');

        can_display = stack_has_loaded;

        break;
      
      /*
        Default cases only require that the stack has content.
      */
      default:
        this.log('Auditing using default priority rules.');

        can_display = this.stack().some(function (slide) { return slide.complete(); });

        break;
    }

    if (!this.initiated() && can_display)
    {
      this.log('Preload conditions met.');

      this.fireEvent(ProjectorNS.READY, this);
    }

    if (!this.complete() && stack_has_loaded)
    {
      this.log('Loading is complete.');

      this.complete(true);

      this.fireEvent(ProjectorNS.COMPLETE, this);
    }

    return this;
  },

  initDisplay: function (event)
  {
    var queued = this.stack().filter(function (slide) { return slide.complete(); }).pick();

    this.initiated(new Date().getTime());

    if (this.container().element().getChildren().pick() !== queued.element())
    {
      this.play(queued, true);
    }
    else
    {
      this.fireEvent(ProjectorNS.WILL_TRANSITION_IN, [queued, this]);

      this.positionAndScaleSlide(this.active(queued));

      this.fireEvent(ProjectorNS.HAS_TRANSITIONED_IN, [queued, this]);
    }

    return this;
  },

  positionAndScale: function (event)
  {
    this.positionAndScaleContainer();

    this.stack().each(function (slide)
    {
      this.positionAndScaleSlide(slide);
    }.bind(this));

    return this;
  },

  positionAndScaleContainer: function ()
  {
    if (this.fullscreen())
    {
      this.container().scaleToViewport();
    }
    else
    {
      this.container().reset();
    }

    return this;
  },

  positionAndScaleSlide: function (slide)
  {
    var dimensions = this.container().element().getSize(), position = this.container().element().getPosition();
    
    slide.positionAndScale(
      dimensions.x, 
      dimensions.y
    );

    return this;
  },

  initTimer: function (event, use_pause_delta)
  {
    var delta = (new Date().getTime() - (use_pause_delta? this.paused(): this.initiated())) / 1000;
    
    this.log('Setting autoplay timer.');

    if (delta >= this.displayDuration())
    {
      this.play();
    }
    else
    {
      this.timeout(this.play.delay((this.displayDuration() - delta) * 1000, this));
    }

    return this;
  },

  initPauseOnHover: function ()
  {
    if (this.pauseOnHover())
    {
      this.container().element().addEvent('mouseover', this.pause.bind(this));
      this.container().element().addEvent('mouseout', this.initTimer.pass([null, true], this));
    }
  },

  play: function (request, bypass_on_pause_check)
  {
    this.paused(null);

    clearTimeout(this.timeout());
    
    if (!this.animating())
    {
      if (!request)
      {
        queued = this.next();
      }
      else
      {
        queued = request;

        if (!bypass_on_pause_check && this.pauseOnChange())
        {
          this.autoplay(false);
        }
      }
      
      this.active(ProjectorNS[queued.transition() || this.transition()](this, this.active(), queued));

      if (!bypass_on_pause_check && this.autoplay())
      {
        this.timeout(this.play.delay(this.displayDuration() * 1000, this));
      }
    }

    return this;
  },

  pause: function ()
  {
    clearTimeout(this.timeout());

    this.paused(new Date().getTime());

    this.log('Pausing playback.');
  },

  next: function ()
  {
    return this.index() + 1 < this.stack().length? this.at(this.index() + 1): this.stack().pick();
  },

  previous: function ()
  {
    return this.index() - 1 >= 0? this.at(this.index() - 1): this.stack().getLast();
  },

  index: function ()
  {
    return this.stack().indexOf(this.active());
  },

  at: function (index)
  {
    return this.stack()[index];
  },

  log: function (message)
  {
    this.debug() && console && console.log(message);
  }
});

var ProjectorNS = 
{
  // Event 'constants'
  LOADED:   'PROJECTOR:loaded',   // Used to signify a partial load event
  READY:    'PROJECTOR:ready',    // Fired when projector has satisfied preload conditions
  COMPLETE: 'PROJECTOR:complete', // Used to signify all elements/dependencies have loaded
  WILL_TRANSITION_IN:   'PROJECTOR:will_transition_in',
  WILL_TRANSITION_OUT:  'PROJECTOR:will_transition_out',
  HAS_TRANSITIONED_IN:  'PROJECTOR:has_transitioned_in',
  HAS_TRANSITIONED_OUT: 'PROJECTOR:has_transitioned_out',

  // Container
  Container: new Class(
  {
    _protected:
    {
      element: null,

      state:   null
    },

    initialize: function (parameters)
    {
      this.element($(parameters.target));

      this.element().setStyles({ 'position':'relative', 'overflow':'hidden' });

      this.state(this.element().getStyles('position', 'width', 'height', 'top', 'left'));

      return this;
    },

    element: function (value)
    {
      if (typeof value !== 'undefined')
      {
        this._protected.element = value;
      }

      return this._protected.element;
    },

    state: function (value)
    {
      if (typeof value !== 'undefined')
      {
        this._protected.state = value;
      }

      return this._protected.state;
    },

    scaleToViewport: function ()
    {
      var viewport = window.getSize();

      this.element().setStyles(
      {
        'position':'fixed',
        'width':viewport.x+'px',
        'height':viewport.y+'px',
        'top':0, 'left':0
      });

      return this;
    },

    reset: function ()
    {
      this.element().setStyles(this.state());

      return this;
    }
  }),

  // Slide
  Slide: new Class(
  {
    Implements: [Events],

    _parameters:
    {
      target:     null, // Optional: (Mixed) The DOM node, node id or image source of the slide's element.

      class_name: null, // Optional: (String) When provided will add the class name to the slide's element on load.
      transition: null, // Optional: (String) Used to override the default transition method from the main class.
      easing: null,     // Optional: (String) Used to override the default easing class from the main class.
      
      anchor: ['CENTRE', 'CENTRE'], // Optional: (Array) Used to tether an image to the specified anchor point during scaling.

      rendering_priority: null, // Global: (String) This is a global variable and cannot be overridden, refer to the main class.
      debug: false              // Global: (Boolean) This is a global variable and cannot be overridden, refer to the main class.
    },
    _protected:
    {
      element:  null,

      aspect:   null,

      complete: false
    },

    initialize: function (parameters)
    {
      // Override defaults
      this.overrideDefaultParameters(parameters);

      // Open up parameter API
      this.initParameterAPI();

      // Init lifecycle event chain
      this.initLifecycle();

      return this;
    },

    overrideDefaultParameters: function (parameters)
    {
      // Unlike Projector which throws away unexpected parameters, slides save them and add new accessors
      // to the API to make customisation easier.
      for (var parameter in parameters)
      {
        this._parameters[parameter] = parameters[parameter];
      }

      return this;
    },

    initParameterAPI: function ()
    {
      var method, parameter;

      for (parameter in Object.merge(this._parameters, this._protected))
      {
        method = parameter.replace(/_[a-z]{1}/g, function ($0) { return $0.substr(-1).toUpperCase(); } );

        if (!this[method])
        {
          this[method] = this.accessor.bind(this, parameter);
        }
      }

      return this;
    },

    accessor: function (parameter, value)
    {
      if (typeof value !== 'undefined')
      {
        this._parameters[parameter.replace(/_[a-z]{1}/g, function($1) { return $1.substr(-1).toUpperCase()})] = value;
      }

      return this._parameters[parameter];
    },

    anchor: function (value)
    {
      if (typeof value !== 'undefined')
      {
        this._parameters.anchor = value;
      }

      if (typeof this._parameters.anchor === 'string')
      {
        this._parameters.anchor = this._parameters.anchor.split(',').map(function (point)
        {
          return point.replace(/\s/g, '');
        });
      }

      return this._parameters.anchor.invoke('toUpperCase');
    },

    easing: function (value)
    {
      if (typeof value !== 'undefined')
      {
        this._parameters.easing = value;
      }

      if (this._parameters.easing && typeof this._parameters.easing !== 'function')
      {
        var parts = this._parameters.easing.split('.'), method = window;

        while (parts.length > 0)
        {
          method = method[parts.shift()];
        }

        this._parameters.easing = method;
      }

      return this._parameters.easing;
    },

    initLifecycle: function ()
    {
      // Element has loaded
      this.addEvent(ProjectorNS.LOADED, this.auditLoadState.bind(this));

      // All elements have loaded
      this.addEvent(ProjectorNS.COMPLETE, this.initDisplay.bind(this));

      return this;
    },

    load: function ()
    {
      var images = [];

      this.log('Loading: ' + this.target());

      // Where the target is not a string, we assume it to be a DOM element
      if (typeof this.target() !== 'string')
      {
        this.element(this.target());
      }

      // Else, where the string appears to be a DOM element id we fetch it
      else if (this.target().match(/^[\-_a-z0-9]+$/i))
      {
        this.element($(this.target()));
      }

      // Where the element is already part of the document...
      if (this.element())
      {
        // ...and it is hidden
        if (this.element().getStyle('display') === 'none')
        {
          // Pull it from the document
          this.element().dispose();
        
          /**
           * Due to an issue in Internet Explorer wherein an image element's load event will never fire
           * if it or it's parent has been 'disposed', we need to create new versions to replace the
           * originals.
           */
          if (this.element().get('tag').toLowerCase() === 'img')
          {
            images = [this.element(this.element().clone(true, true))];
          }
          else
          {
            images = this.element().getElements('img');

            images.each(function (image)
            {
              var clone = image.clone(true, true);

              clone.replaces(image);

              image.destroy();
            });
          }
        }
      }

      // Else, we assume that the target refers to a remote image
      else
      {
        images = [this.element(new Element('img', { 'src':this.target() }))];
      }

      if (images.length > 0)
      { 
        images.each(function (image)
        {
          // Set rendering priority rules
          switch (this.renderingPriority())
          {
            case 'PERFORMANCE':
              image.setStyles(
              {
                '-ms-interpolation-mode': 'nearest-neighbor',
                'image-rendering':        '-moz-crisp-edges'
              });

              break;

            case 'QUALITY':
              image.setStyles(
              {
                '-ms-interpolation-mode': 'bicubic',
                'image-rendering': 'optimizeQuality'
              });

              break;
          }
          
          // Where the image has not been cached
          if (!image.complete)
          {
            // Add on load handler
            image.addEvent('load', function (event)
            {
              this.fireEvent(ProjectorNS.LOADED, this);
            }.bind(this));
          }

          // Else fire loaded event immediately
          else
          {
            this.fireEvent(ProjectorNS.LOADED, this);
          }
        }.bind(this));
      }

      // If there are no images, the slide should already be ready
      else
      {
        this.fireEvent(ProjectorNS.LOADED, this);
      }

      // Add display class if provided
      this.element().addClass(this.className());

      return this;
    },

    auditLoadState: function (event)
    {
      var images = this.element().get('tag') === 'img'? [this.element()]: this.element().getElements('img');
      
      if (images.length === 0 || images.every(function (image) { return image.complete; }))
      {
        this.complete(true);

        this.fireEvent(ProjectorNS.COMPLETE, this);
      }

      return this;
    },

    initDisplay: function (event)
    {
      // Set required styles
      this.element().setStyles(
      {
        'position':'absolute',
        'overflow':'hidden'
      });
    },

    positionAndScale: function (width, height)
    {
      var dimensions, top = 0, left = 0;

      if (this.element())
      {
        if(this.element().get('tag') !== 'img')
        {
          this.element().setStyles(
          {
            'width': width + 'px',
            'height': height + 'px',
            'top': top + 'px', 'left': left + 'px'
          });
        }
        else
        {
          if (!this.aspect())
          {
            dimensions = Element.measure(this.element(), function () { return this.getSize(); });
            
            this.aspect(dimensions.x / dimensions.y);
          }

          if (width / this.aspect() < height)
          {
            dimensions = 
            {
              'x': (height * this.aspect()),
              'y': height
            };
          }
          else
          {
            dimensions = 
            {
              'x': width,
              'y': (width / this.aspect())
            };
          }
          
          this.element().setStyles(
          {
            'width':  dimensions.x + 'px',
            'height': dimensions.y + 'px'
          });
          
          if (this.anchor().indexOf('LEFT') >= 0)
          {
            this.element().setStyles({ 'left':left + 'px'});
          }
          else if (this.anchor().indexOf('RIGHT') >= 0)
          {
            this.element().setStyles({'left':(left - (dimensions.x - width)) + 'px' });
          }
          else
          {
            this.element().setStyles({ 'left':(left - ((dimensions.x - width) / 2)) + 'px'});
          }
          
          if (this.anchor().indexOf('TOP') >= 0)
          {
            this.element().setStyles({ 'top':top + 'px' });
          }
          else if (this.anchor().indexOf('BOTTOM') >= 0)
          {
            this.element().setStyles({ 'top':(top - (dimensions.y - height)) + 'px'});
          }
          else
          {
            this.element().setStyles({ 'top':(top - ((dimensions.y - height) / 2)) + 'px'});
          }
        }
      }

      return this;
    },

    log: function (message)
    {
      this.debug() && console && console.log(message);
    }
  }),

  // Transition methods
  crossfade: function (projector, outbound, inbound)
  {
    var z_index = 1, fx;

    // Get the z-index of the container element where set
    if (!isNaN(projector.container().element().getStyle('z-index')))
    {
      projector.container().element().getStyle('z-index');
    }

    // Prepare the inbound slide and add to stage
    inbound.element().setStyles(
    {
      'display':  'block',
      'opacity':  '0',
      'z-index':  z_index + 1
    });
    inbound.element().inject(projector.container().element(), 'top');

    if (outbound)
    {
      // Prepare the outbound slide
      outbound.element().setStyle('z-index', z_index);

      // Fire outbound 'WILL' event
      projector.fireEvent(ProjectorNS.WILL_TRANSITION_OUT, [outbound, projector]);
    }

    // Init the inbound FX
    fx = new Fx.Morph(inbound.element(),
    {
      'duration':   projector.transitionDuration() * 1000,
      'transition': inbound.easing() || projector.easing()
    });

    // Before start...
    fx.addEvent('start', function ()
    {
      projector.animating(true);

      projector.fireEvent(ProjectorNS.WILL_TRANSITION_IN, [inbound, projector]);
    });

    // Cleanup
    fx.addEvent('complete', function ()
    {
      projector.fireEvent(ProjectorNS.HAS_TRANSITIONED_IN, [inbound, projector]);

      if (outbound)
      {
        outbound.element().dispose();

        projector.fireEvent(ProjectorNS.HAS_TRANSITIONED_OUT, [outbound, projector]);
      }

      projector.animating(false);
    });

    // Start the inbound transition and attach chained methods
    fx.start({'opacity':[0, 1]});

    return inbound;
  },

  fade: function (projector, outbound, inbound)
  {
    var outbound_fx, inbound_fx, placeholder;

    // Ensure that an element exists for the outbound transition
    if (!outbound)
    {
      placeholder = new Element('div');
    }

    // Outbound transition
    outbound_fx = new Fx.Morph(placeholder || outbound.element(),
    {
      'duration':   !placeholder? (projector.transitionDuration() * 1000) / 2: 0,
      'transition': inbound.easing() || projector.easing()
    });

    // Inbound transition
    inbound_fx = new Fx.Morph(inbound.element(),
    {
      'duration':   (projector.transitionDuration() * 1000) / 2,
      'transition': inbound.easing() || projector.easing()
    });

    // Before start...
    outbound_fx.addEvent('start', function ()
    {
      projector.animating(true);

      if (outbound)
      {
        projector.fireEvent(ProjectorNS.WILL_TRANSITION_OUT, [outbound, projector]);
      }
    });

    // Pass to inbound fx
    outbound_fx.addEvent('complete', function ()
    {
      if (outbound)
      {
        outbound.element().dispose();

        projector.fireEvent(ProjectorNS.HAS_TRANSITIONED_OUT, [outbound, projector]);
      }
      else
      {
        placeholder.dispose();
      }

      inbound.element().setStyles(
      {
        'display':  'block',
        'opacity':  '0'
      });
      inbound.element().inject(projector.container().element(), 'top');

      projector.fireEvent(ProjectorNS.WILL_TRANSITION_IN, [inbound, projector]);

      inbound_fx.start({'opacity':[0, 1]});
    });

    // Cleanup
    inbound_fx.addEvent('complete', function ()
    {
      projector.fireEvent(ProjectorNS.HAS_TRANSITIONED_IN, [inbound, projector]);

      projector.animating(false);
    });

    outbound_fx.start({'opacity':[1, 0]});

    return inbound;
  },

  slideLeft: function (projector, outbound, inbound)
  {
    
  },

  slideRight: function (projector, outbound, inbound)
  {
    
  },

  slideUp: function (projector, outbound, inbound)
  {
    
  },

  slideDown: function (projector, outbound, inbound)
  {
    
  },

  carouselLeft: function (projector, outbound, inbound)
  {
    
  },

  carouselRight: function (projector, outbound, inbound)
  {
    
  },

  carouselUp: function (projector, outbound, inbound)
  {
    
  },

  carouselDown: function (projector, outbound, inbound)
  {
    
  }
};