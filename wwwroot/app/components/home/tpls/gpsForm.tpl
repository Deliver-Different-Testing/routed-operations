
<div class="gpsForm">

  <div class="gps-box">
    UPDATE GPS
    <div class="container-fluid">
      <form name="gpsUpdateForm" novalidate>
      <div class="row">
        <div class="col-md-12">
          <div class="form-group">
            <label for="jobNum">Listed Address:</label>
            <div class="input-group">
              <input type="text" ng-model="gpsForm.data.address" class="form-control" />
              <div class="input-group-btn">
                <button class="btn btn-default" type="button" ng-click="copyGpsAddress()">Copy to search</button>
              </div>
            </div>
          </div>
        </div>
        <div class="col-md-4">
            <div class="form-group" ng-class="{'has-error': gpsUpdateForm.latitude.$invalid && gpsUpdateForm.latitude.$touched}">
              <label for="latitude">Latitude:</label>
              <input type="text"
                     name="latitude"
                     ng-model="gpsForm.data.lat"
                     class="form-control"
                     ng-pattern="/^$|^-?\d+\.?\d*$/"
                     ng-change="gpsForm.validateLatLng()"
                     ng-blur="gpsForm.validateLatLng()" />
              <span class="help-block" ng-show="gpsUpdateForm.latitude.$error.pattern">
                Invalid format. Must be a decimal number (e.g., -36.850657)
              </span>
              <span class="help-block" ng-show="gpsUpdateForm.latitude.$error.range">
                Latitude must be between -90 and 90 degrees
              </span>
            </div>
        </div>
        <div class="col-md-4">
            <div class="form-group" ng-class="{'has-error': gpsUpdateForm.longitude.$invalid && gpsUpdateForm.longitude.$touched}">
              <label for="longitude">Longtitude:</label>
              <input type="text"
                     name="longitude"
                     ng-model="gpsForm.data.long"
                     class="form-control"
                     ng-pattern="/^$|^-?\d+\.?\d*$/"
                     ng-change="gpsForm.validateLatLng()"
                     ng-blur="gpsForm.validateLatLng()" />
              <span class="help-block" ng-show="gpsUpdateForm.longitude.$error.pattern">
                Invalid format. Must be a decimal number (e.g., 174.764660)
              </span>
              <span class="help-block" ng-show="gpsUpdateForm.longitude.$error.range">
                Longitude must be between -180 and 180 degrees
              </span>
            </div>
        </div>
		  <div class="col-md-4">
            <div class="form-group">
              <label for="PostCode">ZipCode:</label>
              <input type="text" ng-model="gpsForm.data.postCode" class="form-control" />
            </div>
        </div>
        <div class="col-md-12">
		   <input class="form-control"
		    places-auto-complete
			ng-model="gpsForm.search"
			component-restrictions="{country:'{{gpsForm.country}}'}"
			types="['address']"
			on-place-changed="gpsForm.placeChanged()" />
          
        </div>

        <div class="col-md-12">
		  <div class="form-group">
            <label for="type">Map:</label>
			 <ng-map id="map" center="[{{gpsForm.data.lat || -36.850657}}, {{gpsForm.data.long ||  174.764660}}]" on-rightclick="gpsForm.moveMarker()">
			 <marker position="{{gpsForm.data.lat}}, {{gpsForm.data.long}}" draggable="true" on-dragend="gpsForm.markerDragend()"></marker>
			 </ng-map>		 
			 </div>

       <!--    <div class="form-group">
            <label for="type">Map:</label>
            <iframe
              width="450"
              height="250"
              frameborder="0" style="border:0"
              id="gpsMap"
              data-src="https://www.google.com/maps/embed/v1/place?key=AIzaSyC9qU2-Zu7KwkO6TqtY5p-2P4czmpF98nA&q=" allowfullscreen>
            </iframe>
          </div> -->

        <button class="btn btn-primary" ng-click="gpsForm.submit(gpsForm.details)" ng-disabled="gpsUpdateForm.$invalid">UPDATE</button>
        <button class="btn btn-default" ng-click="gpsForm.cancel()">Cancel</button>

        </div>
      </div>
      </form>
    </div>
  </div>
</div>