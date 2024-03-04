<div id="map" style="position:absolute; width:100%; height:100%; background:grey"></div>

<div class="loading">
    <div class="text">
        <i class="fas fa-spinner fa-spin fa-spin fa-3x fa-fw"></i>
        <span class="sr-only">Loading...</span>
    </div>
</div>

<script>

/* HereMap API Start */

/**
 * Calculates and displays a car route from the Brandenburg Gate in the centre of Berlin
 * to Friedrichstraﬂe Railway Station.
 *
 * A full list of available request parameters can be found in the Routing API documentation.
 * see:  http://developer.here.com/rest-apis/documentation/routing/topics/resource-calculate-route.html
 *
 * @param   {H.service.Platform} platform    A stub class to access HERE services
 */
function calculateRouteFromAtoB (platform, waypoints) {

  var router = platform.getRoutingService(),
	  waypoints.mode: 'fastest;car',
      waypoints.representation: 'display',
      waypoints.routeattributes : 'waypoints,summary,shape,legs',
      waypoints.maneuverattributes: 'direction,action',

  router.calculateRoute(
    waypoints,
    onSuccess,
    onError
  );
}
/**
 * This function will be called once the Routing REST API provides a response
 * @param  {Object} result          A JSONP object representing the calculated route
 *
 * see: http://developer.here.com/rest-apis/documentation/routing/topics/resource-type-calculate-route.html
 */
function onSuccess(result) {
  var route = result.response.route[0];
 /*
  * The styling of the route response on the map is entirely under the developer's control.
  * A representitive styling can be found the full JS + HTML code of this example
  * in the functions below:
  */
  addRouteShapeToMap(route);
  addManueversToMap(route);

  addWaypointsToPanel(route.waypoint);
  addManueversToPanel(route);
  addSummaryToPanel(route.summary);
  // ... etc.
}

/**
 * This function will be called if a communication error occurs during the JSON-P request
 * @param  {Object} error  The error message received.
 */
function onError(error) {
  alert('Ooops!');
}

/**
 * Boilerplate map initialization code starts below:
 */

// set up containers for the map  + panel
var mapContainer = document.getElementById('map'),
  routeInstructionsContainer = document.getElementById('panel');

//Step 1: initialize communication with the platform
var platform = new H.service.Platform({
  app_id: 'bBPfh2x8Cauun3ygLMAx',
  app_code: 'yjfwTdkin_R2rGXYTrwWVg',
  useHTTPS: true
});
var pixelRatio = window.devicePixelRatio || 1;
var defaultLayers = platform.createDefaultLayers({
  tileSize: pixelRatio === 1 ? 256 : 512,
  ppi: pixelRatio === 1 ? undefined : 320
});

//Step 2: initialize a map - this map is centered over Auckalnd
var map = new H.Map(mapContainer,
  defaultLayers.normal.map,{
  center: {lat:-36.8804466, lng:174.6117981}, 
  zoom: 13,
  pixelRatio: pixelRatio
});

//Step 3: make the map interactive
// MapEvents enables the event system
// Behavior implements default interactions for pan/zoom (also on mobile touch environments)
var behavior = new H.mapevents.Behavior(new H.mapevents.MapEvents(map));

// Create the default UI components
var ui = H.ui.UI.createDefault(map, defaultLayers);

// Hold a reference to any infobubble opened
var bubble;

/**
 * Opens/Closes a infobubble
 * @param  {H.geo.Point} position     The location on the map.
 * @param  {String} text              The contents of the infobubble.
 */
function openBubble(position, text){
 if(!bubble){
    bubble =  new H.ui.InfoBubble(
      position,
      // The FO property holds the province name.
      {content: text});
    ui.addBubble(bubble);
  } else {
    bubble.setPosition(position);
    bubble.setContent(text);
    bubble.open();
  }
}


/**
 * Creates a H.map.Polyline from the shape of the route and adds it to the map.
 * @param {Object} route A route as received from the H.service.RoutingService
 */
function addRouteShapeToMap(route){
  var lineString = new H.geo.LineString(),
    routeShape = route.shape,
    polyline;

  routeShape.forEach(function(point) {
    var parts = point.split(',');
    lineString.pushLatLngAlt(parts[0], parts[1]);
  });

  polyline = new H.map.Polyline(lineString, {
    style: {
      lineWidth: 4,
      strokeColor: 'rgba(0, 128, 255, 0.7)'
    }
  });
  // Add the polyline to the map
  map.addObject(polyline);
  // And zoom to its bounding rectangle
  map.setViewBounds(polyline.getBounds(), true);
}


/**
 * Creates a series of H.map.Marker points from the route and adds them to the map.
 * @param {Object} route  A route as received from the H.service.RoutingService
 */
function addManueversToMap(route){
  var svgMarkup = '<svg width="18" height="18" ' +
    'xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="8" cy="8" r="8" ' +
      'fill="#1b468d" stroke="white" stroke-width="1"  />' +
    '</svg>',
    dotIcon = new H.map.Icon(svgMarkup, {anchor: {x:8, y:8}}),
    group = new  H.map.Group(),
    i,
    j;

  // Add a marker for each maneuver
  for (i = 0;  i < route.leg.length; i += 1) {
    for (j = 0;  j < route.leg[i].maneuver.length; j += 1) {
      // Get the next maneuver.
      maneuver = route.leg[i].maneuver[j];
      // Add a marker to the maneuvers group
      var marker =  new H.map.Marker({
        lat: maneuver.position.latitude,
        lng: maneuver.position.longitude} ,
        {icon: dotIcon});
      marker.instruction = maneuver.instruction;
      group.addObject(marker);
    }
  }

  group.addEventListener('tap', function (evt) {
    map.setCenter(evt.target.getPosition());
    openBubble(
       evt.target.getPosition(), evt.target.instruction);
  }, false);

  // Add the maneuvers group to the map
  map.addObject(group);
}


/**
 * Creates a series of H.map.Marker points from the route and adds them to the map.
 * @param {Object} route  A route as received from the H.service.RoutingService
 */
function addWaypointsToPanel(waypoints){



  var nodeH3 = document.createElement('h3'),
    waypointLabels = [],
    i;


   for (i = 0;  i < waypoints.length; i += 1) {
    waypointLabels.push(waypoints[i].label)
   }

   nodeH3.textContent = waypointLabels.join(' - ');

  routeInstructionsContainer.innerHTML = '';
  routeInstructionsContainer.appendChild(nodeH3);
}

/**
 * Creates a series of H.map.Marker points from the route and adds them to the map.
 * @param {Object} route  A route as received from the H.service.RoutingService
 */
function addSummaryToPanel(summary){
  var summaryDiv = document.createElement('div'),
   content = '';
   content += '<b>Total distance</b>: ' + summary.distance  + 'm. <br/>';
   content += '<b>Travel Time</b>: ' + summary.travelTime.toMMSS() + ' (in current traffic)';


  summaryDiv.style.fontSize = 'small';
  summaryDiv.style.marginLeft ='5%';
  summaryDiv.style.marginRight ='5%';
  summaryDiv.innerHTML = content;
  routeInstructionsContainer.appendChild(summaryDiv);
}

/**
 * Creates a series of H.map.Marker points from the route and adds them to the map.
 * @param {Object} route  A route as received from the H.service.RoutingService
 */
function addManueversToPanel(route){



  var nodeOL = document.createElement('ol'),
    i,
    j;

  nodeOL.style.fontSize = 'small';
  nodeOL.style.marginLeft ='5%';
  nodeOL.style.marginRight ='5%';
  nodeOL.className = 'directions';

     // Add a marker for each maneuver
  for (i = 0;  i < route.leg.length; i += 1) {
    for (j = 0;  j < route.leg[i].maneuver.length; j += 1) {
      // Get the next maneuver.
      maneuver = route.leg[i].maneuver[j];

      var li = document.createElement('li'),
        spanArrow = document.createElement('span'),
        spanInstruction = document.createElement('span');

      spanArrow.className = 'arrow '  + maneuver.action;
      spanInstruction.innerHTML = maneuver.instruction;
      li.appendChild(spanArrow);
      li.appendChild(spanInstruction);

      nodeOL.appendChild(li);
    }
  }

  routeInstructionsContainer.appendChild(nodeOL);
}


Number.prototype.toMMSS = function () {
  return  Math.floor(this / 60)  +' minutes '+ (this % 60)  + ' seconds.';
}

// Now use the map as required...
calculateRouteFromAtoB (platform);


/* HereMap API End */



// /* Google Map API Start */

//     var directionDisplay;
//     var directionsService = new google.maps.DirectionsService();
//     var map;

//     function initialize() {
//         directionsDisplay = new google.maps.DirectionsRenderer({
// 		    suppressMarkers: true
// 		});
//         var auckland = new google.maps.LatLng(-36.8804466,174.6117981);
//         var myOptions = {
//             zoom: 10,
//             mapTypeId: google.maps.MapTypeId.ROADMAP,
//             center: auckland,
// 			gestureHandling: 'greedy'
//         }
//         map = new google.maps.Map(document.getElementById("map_canvas"), myOptions);
//         directionsDisplay.setMap(map);
//     }
//     google.maps.event.addDomListener(window, 'load', initialize);


// 	var markersArray = [];
// 	var selectedRunMarkersArray = [];

// 	var isCtrl = false;
// 	window.onkeydown = function(e) {
// 	  isCtrl = ((e.keyIdentifier == 'Control') || (e.ctrlKey == true));
// 	}
// 	window.onkeyup = function(e) {
// 	  isCtrl = false;
// 	}

// 	function addClickHandler(theMarker) {
// 	  // Clear selectedRunMarkers for zoom;
// 	  selectedRunMarkersArray.push(theMarker);

// 	  markersArray.push(theMarker);
// 	  google.maps.event.addListener(theMarker, 'mouseover', function() {
// 			angular.element(".columns").scope().selectJobFromMap(this.position.lat(), this.position.lng());
// 	  });

// 	  google.maps.event.addListener(theMarker, 'rightclick', function() {
// 			angular.element(".columns").scope().removeJobFromMap(this.position.lat(), this.position.lng());
// 	  });

// 	  google.maps.event.addListener(theMarker, 'click', function() {
// 	  		angular.element(".columns").scope().setJobEndFromMap(this.position.lat(), this.position.lng());
// 	  });
// 	}

// 	function addGreyClickHandler(theMarker) {

// 	  markersArray.push(theMarker);

// 	  google.maps.event.addListener(theMarker, 'click', function() {
// 	  		angular.element(".columns").scope().addToRunFromMap(this.position.lat(), this.position.lng(), this.jn);
// 	  });

// 	}

// 	var delayFactor = 0;
// 	var boundsSet = false;

// 	function setMapBounds() {
//         boundsSet = true;
//         var bounds = new google.maps.LatLngBounds();
//         for (var i = 0; i < selectedRunMarkersArray.length; i++) {
//             bounds.extend(selectedRunMarkersArray[i].getPosition());
//         }

//         map.fitBounds(bounds);
//      }

// 	 function highlightPin(job) {
// 		//console.log ('finding ' + job.toLat.toString().substr(0,9) + ',' +  job.toLng.toString().substr(0,9) );
// 		for (var i = 0; i < markersArray.length; i++) {
// 		//console.log(markersArray[i].position.lat().toString().substr(0,9) + ',' + markersArray[i].position.lng().toString().substr(0,9) );
// 		}
// 		var marker = markersArray.find(obj => {
// 		  return obj.position.lat().toString().substr(0,9) === job.toLat.toString().substr(0,9) && obj.position.lng().toString().substr(0,9) === job.toLng.toString().substr(0,9);
// 		})
// 		if (marker === undefined) return;
// 		marker.setAnimation(google.maps.Animation.BOUNCE);
// 		window.setTimeout(function() {
// 			if (marker.getAnimation() !== null) {
// 			  marker.setAnimation(null);
// 			} 
//         }, 1000);
// 	 }

// 	function drawDirections(response){
// 		//debugger;

// 		       directionsDisplay.setDirections(response);

//                 var route = response.routes[0];
//                 //console.log(route);
//                 //var summaryPanel = document.getElementById("directions_panel");
//                 //summaryPanel.innerHTML = "";
//                 // For each route, display summary information.

//                 var displayText = '';
//                 var arrival = new Date();

//                 var secondsToArrival = 0;
//                 // set arrival time
//                 arrival.setHours(15);
//                 arrival.setMinutes(0);
//                 arrival.setSeconds(0);

// 				//var labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// 				var labelIndex = 1;
// 				while(markersArray.length) { markersArray.pop().setMap(null); }

// 				//// Don't remove marker until all parts are mapped
// 				//if(totalRouteParts.length > 0){
// 				//	labelIndex = (totalRouteParts[0]-1) * 25;
// 				//	totalRouteParts.splice(0,1);
// 				//}else{
// 				//	while(markersArray.length) { markersArray.pop().setMap(null); }
// 				//}

//                 // let's calculate back.  From finish to start
//                 for (var i = route.legs.length - 1; i >= 0; i--) {
//                     //summaryPanel.innerHTML +=  +'s<br>';
//                     secondsToArrival += route.legs[i].duration.value;
//                     // new date variable.
//                     var startAtWaypoint = new Date();
//                     startAtWaypoint.setHours(arrival.getHours());
//                     startAtWaypoint.setMinutes(arrival.getMinutes());
//                     startAtWaypoint.setSeconds(arrival.getSeconds());

//                     // calculate difference.  We subtract the seconds.
//                     startAtWaypoint.setSeconds(arrival.getSeconds() - secondsToArrival);
//                 }

// 				// Clear selected run markers for zooming 
// 				selectedRunMarkersArray = [];
//                 for (var i = 0; i < route.legs.length; i++) {
//                 	if (i == 0) {
// 						var pinColor = "b0f26f";
// 					    var pinImage = new google.maps.MarkerImage("http://chart.apis.google.com/chart?chst=d_map_pin_letter&chld=%E2%80%A2|" + pinColor,
// 					        new google.maps.Size(131, 154),
// 					        new google.maps.Point(0,0),
// 					        new google.maps.Point(10, 34));
// 					    var pinShadow = new google.maps.MarkerImage("http://chart.apis.google.com/chart?chst=d_map_pin_shadow",
// 					        new google.maps.Size(40, 37),
// 					        new google.maps.Point(0, 0),
// 					        new google.maps.Point(12, 35));

// 		                    //console.log(route.legs[i]);
// 		                    var posi = { lat: route.legs[i].start_location.lat(), lng: route.legs[i].start_location.lng() };

// 							//console.log(posi);
// 							var marker = new google.maps.Marker({
// 							 	position: posi,
// 							 	map: map,
//                 				//icon: pinImage
// 								icon: createPin('#b0f26f')
// 							});

//  							addClickHandler(marker);

//                 	} else {
// 						var orderNumber = labelIndex++;

// 	                    //console.log(route.legs[i]);
// 	                    var posi = { lat: route.legs[i].start_location.lat(), lng: route.legs[i].start_location.lng() };
	                    
// 						//console.log(posi);
// 						var marker = new google.maps.Marker({
// 						 	position: posi,
// 						 	map: map,
// 				   			//label: labels[labelIndex++ % labels.length]
// 							label: orderNumber.toString()
// 						});

// 	 					addClickHandler(marker);

//                 	}


// 				    if (i == route.legs.length - 1) {

// 						var pinColor = "6fb4f0";
// 					    var pinImage = new google.maps.MarkerImage("http://chart.apis.google.com/chart?chst=d_map_pin_letter&chld=%E2%80%A2|" + pinColor,
// 					        new google.maps.Size(31, 44),
// 					        new google.maps.Point(0,0),
// 					        new google.maps.Point(10, 34));
// 					    var pinShadow = new google.maps.MarkerImage("http://chart.apis.google.com/chart?chst=d_map_pin_shadow",
// 					        new google.maps.Size(40, 37),
// 					        new google.maps.Point(0, 0),
// 					        new google.maps.Point(12, 35));



// 				      	var posi = { lat: route.legs[i].end_location.lat(), lng: route.legs[i].end_location.lng() };
// 						var marker = new google.maps.Marker({
// 					    	position: posi,
// 					    	map: map,
//                 			//icon: pinImage
// 							icon: createPin('#6fb4f0')
// 					  	});
// 				      	addClickHandler(marker);
// 				    }

//                 }

//                 var greyMarkers = angular.element(".columns").scope().potentialJobs;

//                 for (var i = 0; i < greyMarkers.length; i++) {
//                 	var lat = greyMarkers[i].lat;
//                 	var lng = greyMarkers[i].lng;
//                 	var jn = greyMarkers[i].jn;

// 					var pinColor = "c7c7c7";
// 			   		var pinImage = new google.maps.MarkerImage("http://chart.apis.google.com/chart?chst=d_map_pin_letter&chld=%E2%80%A2|" + pinColor,
// 			        new google.maps.Size(131, 154),
// 			        new google.maps.Point(0,0),
// 			        new google.maps.Point(10, 34));
// 					var pinShadow = new google.maps.MarkerImage("http://chart.apis.google.com/chart?chst=d_map_pin_shadow",
// 			        new google.maps.Size(40, 37),
// 			        new google.maps.Point(0, 0),
// 			        new google.maps.Point(12, 35));

// 			        var posi = { lat: lat, lng: lng };
// 					var marker = new google.maps.Marker({
// 					 	position: posi,
// 					 	map: map,
// 						//icon: pinImage,
// 						icon: createPin('#c7c7c7'),
// 						jn: jn
// 					});

// 					addGreyClickHandler(marker);
//                 }
//        computeTotalDistance(response);

// 	   $("#box-map .loading").fadeOut();
// 	}

//  function drawMarker(route, sorted){
// 		//debugger;
// 		       //directionsDisplay.setDirections(response);

//                // var route = response.routes[0];

//                 var displayText = '';
//                 var arrival = new Date();

//                 var secondsToArrival = 0;
//                 // set arrival time
//                 arrival.setHours(15);
//                 arrival.setMinutes(0);
//                 arrival.setSeconds(0);

// 				while(markersArray.length) { markersArray.pop().setMap(null); }

// 				//// Don't remove marker until all parts are mapped
// 				//if(totalRouteParts.length > 0){
// 				//	labelIndex = (totalRouteParts[0]-1) * 25;
// 				//	totalRouteParts.splice(0,1);
// 				//}else{
// 				//	while(markersArray.length) { markersArray.pop().setMap(null); }
// 				//}

// 				// Clear selected run markers for zooming 
// 				selectedRunMarkersArray = [];

//                 for (var i = 0; i < route.length; i++) {
// 					// Start Point
// 					if (i== 0) {
// 						////Remove start location from the Marker only view
// 						//var pinColor = "b0f26f";
//                             //var pinImage = new google.maps.MarkerImage("http://chart.apis.google.com/chart?chst=d_map_pin_letter&chld=%E2%80%A2|" + pinColor,
//                                 //new google.maps.Size(131, 154),
//                                 //new google.maps.Point(0,0),
//                                 //new google.maps.Point(10, 34));
//                             //var pinShadow = new google.maps.MarkerImage("http://chart.apis.google.com/chart?chst=d_map_pin_shadow",
//                                 //new google.maps.Size(40, 37),
//                                 //new google.maps.Point(0, 0),
//                                 //new google.maps.Point(12, 35));

//                                 ////console.log(posi);
//                                 //var marker = new google.maps.Marker({
//                                     //position: route[i],
//                                     //map: map,
//                                     //icon: pinImage
//                                     ////label: labels[labelIndex++ % labels.length]
//                                 //});

//                                 //addClickHandler(marker);
//                             //}
// 							}
// 					// End Point
// 					else if (i == route.length - 1){
// 								var pinColor = "6fb4f0";
// 								var pinImage = new google.maps.MarkerImage("http://chart.apis.google.com/chart?chst=d_map_pin_letter&chld=%E2%80%A2|" + pinColor,
// 									new google.maps.Size(31, 44),
// 									new google.maps.Point(0,0),
// 									new google.maps.Point(10, 34));
// 								var pinShadow = new google.maps.MarkerImage("http://chart.apis.google.com/chart?chst=d_map_pin_shadow",
// 									new google.maps.Size(40, 37),
// 									new google.maps.Point(0, 0),
// 									new google.maps.Point(12, 35));

// 				      			var marker = new google.maps.Marker({
// 					    			position: route[i],
// 					    			map: map,
//                 					//icon: pinImage
// 									icon: createPin('#6fb4f0')
// 					  			});
// 				      			addClickHandler(marker);
// 							}
// 					else{
// 							var labelName ="";
// 							if (sorted){
// 							 labelName = i;
// 							}

// 							var marker = new google.maps.Marker({
// 								position: route[i],
// 								map: map,
// 								label: labelName.toString()
// 							});

// 	 						addClickHandler(marker);     
// 					}
//                 }

//                 var greyMarkers = angular.element(".columns").scope().potentialJobs;

//                 for (var i = 0; i < greyMarkers.length; i++) {
//                 	var lat = greyMarkers[i].lat;
//                 	var lng = greyMarkers[i].lng;
//                 	var jn = greyMarkers[i].jn;

// 					var pinColor = "c7c7c7";
// 			   		var pinImage = new google.maps.MarkerImage("http://chart.apis.google.com/chart?chst=d_map_pin_letter&chld=%E2%80%A2|" + pinColor,
// 			        new google.maps.Size(131, 154),
// 			        new google.maps.Point(0,0),
// 			        new google.maps.Point(10, 34));
// 					var pinShadow = new google.maps.MarkerImage("http://chart.apis.google.com/chart?chst=d_map_pin_shadow",
// 			        new google.maps.Size(40, 37),
// 			        new google.maps.Point(0, 0),
// 			        new google.maps.Point(12, 35));

// 			        var posi = { lat: lat, lng: lng };
// 					var marker = new google.maps.Marker({
// 					 	position: posi,
// 					 	map: map,
// 						//icon: pinImage,
// 						icon: createPin('#c7c7c7'),
// 						jn: jn
// 					});

// 					addGreyClickHandler(marker);
//                 }

// 	   setMapBounds();  
// 	   angular.element(".columns").scope().$apply();
// 	   $("#box-map .loading").fadeOut();
// 	}

//     function calcRoute(onlyDrawMarks) {
	
// 		//debugger;
// 		$("#box-map").find(".loading").show();

// 		// Get all latlng for creating marks
// 		var checkboxArray = angular.element(".columns").scope().defaultRun;
// 		var start = angular.element(".columns").scope().defaultRunStart;
//     	var end = angular.element(".columns").scope().defaultRunEnd;
// 		var routeResponse = angular.element(".columns").scope().defaultRouteResponse;
// 		var waypts = [];

// 		if(!start || !end) return false;

// 		// One time routing 
// 		if(onlyDrawMarks)
// 		{
// 		  var runBuilderJobs = angular.element(".columns").scope().runBuilder;
// 		  checkboxArray = runBuilderJobs.map(x=> { return {lat:x.toLat, lng: x.toLng}});
// 		  checkboxArray.unshift(start);
// 		  var unSortedByRunOrder = runBuilderJobs.filter(j => j.BuilderIndex == null || j.BuilderIndex == "undefined").length > 0;
// 		  if(checkboxArray.length > 0){
// 				if(unSortedByRunOrder){
// 				   drawMarker(checkboxArray);
// 				} else {
// 					// DrawMarker with run order sorted
// 					drawMarker(checkboxArray, !unSortedByRunOrder);
// 				}
// 		   }
// 		} 
// 		else{
// 			//var checkboxArray = angular.element(".columns").scope().defaultRun;
    	
// 			//if(routeResponse) {
// 			//	drawDirections(routeResponse);
// 			//	return;
// 			//}

// 			//if(!start || !end) return false;

// 			for (var i = 0; i < checkboxArray.length; i++) {

//         		//console.log(checkboxArray);

// 				var adresanesto = checkboxArray[i];
// 				if (adresanesto !== "") {
// 					waypts.push({
// 						location: adresanesto,
// 						stopover: true
// 					});
// 				}          
// 			}

// 			var request = {
// 				// from: Blackpool to: Preston to: Blackburn
// 				origin: start,
// 				destination: end,
// 				waypoints: waypts,
// 				optimizeWaypoints: true,
// 				travelMode: google.maps.DirectionsTravelMode.DRIVING
// 			};

// 			if(checkboxArray.length > 23) {
// 				//debugger;

// 				// Add start_location and end_location to the waypoints for routesavvy
// 				checkboxArray.splice(0,0,start);
// 				checkboxArray.push(end);

// 				angular.element(".columns").scope().callRouteSavvy(checkboxArray);
// 				return false;
// 			}

// 			directionsService.route(request, function (response, status) {
// 				if (status == google.maps.DirectionsStatus.OK) {
// 					drawDirections(response);

// 				} else if (status === google.maps.DirectionsStatus.OVER_QUERY_LIMIT) {
// 					delayFactor++;
// 					//setTimeout(function () {
// 					   // calcRoute();
//            			//}, delayFactor * 1000);
// 					$("#box-map").find(".loading").fadeOut();
//         		} else {
// 					$("#box-map").find(".loading").fadeOut();
// 					alert("directions response " + status);
// 				}
// 			});

// 		}
//     }

// 	function drawDirectionsMoreThan23Waypoints(orderedLocations){
// 		// var combinedResults;
//         // var unsortedResults = [{}]; // to hold the counter and the results themselves as they come back, to later sort
//         // var directionsResultsReturned = 0;

//         // // debugger;
//         // // Divide route to several parts because max stations limit is 25 (23 waypoints + 1 origin + 1 destination)
//         // for (var i = 0, parts = [], max = 25 - 1; i < orderedLocations.length; i = i + max){
//         //         parts.push(orderedLocations.slice(i, i + max + 1));
//         // }

//         // // Insert total route parts for order sorts later
//         // totalRouteParts = [];
//         // for(var i = 0; i< parts.length; i++){
//         //     totalRouteParts.push(i+1);
//         // }

//         // // Send requests to service to get route (for stations count <= 25 only one request will be sent)
//         // for (var i = 0; i < parts.length; i++) {
//         //     var waypts = [];
//         //     for (var j = 1; j < parts[i].length - 1; j++) {
//         //          waypts.push({location: parts[i][j], stopover: true});
//         //     }

//         //     var request = {
//         //         // from: Blackpool to: Preston to: Blackburn
//         //         origin: parts[i][0],
//         //         destination: parts[i][parts[i].length - 1],
//         //         waypoints: waypts,
//         //         optimizeWaypoints: true,
//         //         travelMode: google.maps.DirectionsTravelMode.DRIVING
//         //     };


// 		//debugger;

// 		   var parts = [];
//             var itemsPerPart = 25; // google API max = 10 - 1 start, 1 stop, and 8 waypoints
//             var itemsCounter = 0;
//             var wayptsExist = orderedLocations.length > 0;

//             while (wayptsExist) {
//                 var subPart = [];
//                 var subitemsCounter = 0;

//                 for (var j = itemsCounter; j < orderedLocations.length; j++) {
//                     subitemsCounter++;
//                     subPart.push({
//                         location: new window.google.maps.LatLng(orderedLocations[j].lat, orderedLocations[j].lng),
//                         stopover: true
//                     });
//                     if (subitemsCounter == itemsPerPart)
//                         break;
//                 }

//                 itemsCounter += subitemsCounter;
//                 parts.push(subPart);
//                 wayptsExist = itemsCounter < orderedLocations.length;
//                 // If it runs again there are still points. Minus 1 before continuing to 
//                 // start up with end of previous tour leg
//                 itemsCounter--;
//             }

//             // now we should have a 2 dimensional array with a list of a list of waypoints
//             var combinedResults;
//             var unsortedResults = [{}]; // to hold the counter and the results themselves as they come back, to later sort
//             var directionsResultsReturned = 0;

//             for (var k = 0; k < parts.length; k++) {
//                 var lastIndex = parts[k].length - 1;
//                 var start = parts[k][0].location;
//                 var end = parts[k][lastIndex].location;

//                 // trim first and last entry from array
//                 var waypts = [];
//                 waypts = parts[k];
//                 waypts.splice(0, 1);
//                 waypts.splice(waypts.length - 1, 1);

//                 var request = {
//                     origin: start,
//                     destination: end,
//                     waypoints: waypts,
// 					optimizeWaypoints: true,
// 					travelMode: google.maps.DirectionsTravelMode.DRIVING
//                 };

// 			(function(kk){
// 				//debugger;
//     			directionsService.route(request, function (response, status) {
// 				if (status == google.maps.DirectionsStatus.OK) {

// 				  var unsortedResult = {
//                         order : kk,
//                         result : response
//                     };
//                     unsortedResults.push(unsortedResult);
//                     directionsResultsReturned++;

// 				// //debugger;
//                 // //drawDirections(response);
//                 // if (directionsResultsReturned == 0) // first results. new up the combinedResults object
//                 //     combinedResults = response;
//                 // else {
//                 //     // only building up legs, overview_path, and bounds in my consolidated object. This is not a complete
//                 //     // directionResults object, but enough to draw a path on the map, which is all I need
//                 //     combinedResults.routes[0].legs = combinedResults.routes[0].legs.concat(response.routes[0].legs);
//                 //     combinedResults.routes[0].overview_path = combinedResults.routes[0].overview_path.concat(response.routes[0].overview_path);
 
//                 //     combinedResults.routes[0].bounds = combinedResults.routes[0].bounds.extend(response.routes[0].bounds.getNorthEast());
//                 //     combinedResults.routes[0].bounds = combinedResults.routes[0].bounds.extend(response.routes[0].bounds.getSouthWest());
//                 // }

//                 // directionsResultsReturned++;
//                 // if(directionsResultsReturned == totalRouteParts.length){
//                 //     drawDirections(combinedResults);
//                 //  }

// 					if (directionsResultsReturned == parts.length) // we've received all the results. put to map
// 					{
// 						// sort the returned values into their correct order
// 						unsortedResults.sort(function (a, b) { return parseFloat(a.order) - parseFloat(b.order); });
// 						var count = 0;
// 						for (var key in unsortedResults) {
// 							if (unsortedResults[key].result != null) {
// 								if (unsortedResults.hasOwnProperty(key)) {
// 									if (count == 0) // first results. new up the combinedResults object
// 										combinedResults = unsortedResults[key].result;
// 									else {
// 									 //debugger;
// 										// only building up legs, overview_path, and bounds in my consolidated object. This is not a complete 
// 										// directionResults object, but enough to draw a path on the map, which is all I need
// 										combinedResults.routes[0].legs = combinedResults.routes[0].legs.concat(unsortedResults[key].result.routes[0].legs);
// 										combinedResults.routes[0].overview_path = combinedResults.routes[0].overview_path.concat(unsortedResults[key].result.routes[0].overview_path);
// 										combinedResults.routes[0].waypoint_order = combinedResults.routes[0].waypoint_order.concat(unsortedResults[key].result.routes[0].waypoint_order.map(x => x + (count * 23)));

// 										combinedResults.routes[0].bounds = combinedResults.routes[0].bounds.extend(unsortedResults[key].result.routes[0].bounds.getNorthEast());
// 										combinedResults.routes[0].bounds = combinedResults.routes[0].bounds.extend(unsortedResults[key].result.routes[0].bounds.getSouthWest());
// 									}
// 									count++;
// 								}
// 							}
// 						}
// 						//directionsDisplay.setDirections(combinedResults);
					
// 						drawDirections(combinedResults);
// 					} 
// 				} else if (status === google.maps.DirectionsStatus.OVER_QUERY_LIMIT) {
// 					delayFactor++;
// 					//setTimeout(function () {
// 					   // calcRoute();
//            			//}, delayFactor * 1000);
//         		} else {
// 					alert("directions response " + status);
// 				}
// 				});
// 			})(k);
// 		}
// 	}

//     function computeTotalDistance(result) {
// 	 //debugger;
//         var totalDist = 0;
//         var totalTime = 0;
//         var myroute = result.routes[0];
//         var newOrder = [];
//         for (i = 0; i < myroute.legs.length; i++) {
//             totalDist += myroute.legs[i].distance.value;
//             totalTime += myroute.legs[i].duration.value;
//             newOrder.push({
//             	"lat": myroute.legs[i].end_location.lat(),
//             	"lng": myroute.legs[i].end_location.lng()
//             });
//         }

//         totalDist = totalDist / 1000;

//         var totalTime = (totalTime / 60).toFixed(0);

//         angular.element(".columns").scope().updateRunDetails(totalTime, Math.round(totalDist), myroute.legs.length, newOrder, result);
// 		//angular.element(".columns").scope().updateRunDetails(totalTime, Math.round(totalDist), myroute.legs.length, myroute.waypoint_order, result);
//         angular.element(".columns").scope().$apply();
//     }

// 	function createPin (color) {
//         return {
//             path: 'M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z',
//             fillColor: color,
//             fillOpacity: 1,
//             strokeColor: '#000',
//             strokeWeight: 2,
//             scale: 1,
//             labelOrigin: new google.maps.Point(0, -30)
//         };
//     }

//     initialize();
  
// /* Google Map API End */

</script>


<div class="no-data" ng-if="defaultRun.length == 0">
    <div class="text">Please select a run with jobs</div>
</div>