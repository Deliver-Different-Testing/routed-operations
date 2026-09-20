<style>
    /* Simple footer layout for the date-picker popup: right-align the
       Done / Cancel buttons with a subtle top divider. Build criteria
       (Build Parameter / Minutes per stop / Vehicle Capacity) have moved
       to the standalone Build Runs configuration modal. */
    .dateServiceForm .rb-footer-row {
        border-top: 1px solid #eee;
        margin-top: 16px;
        padding-top: 16px;
    }
    .dateServiceForm .rb-footer-actions {
        text-align: right;
    }
    .dateServiceForm .rb-footer-actions .btn {
        margin-left: 6px;
    }
</style>

<div class="dateServiceForm" ng-show="dateService == 1">
    <div class="dateService">

      <div class="container-fluid">
		 <div class="row">
				<div class="col-md-6">
				   <b>Select Client:</b> <br />
				   <i><span ng-repeat="item in pickDateService.clients">{{item.label}}  </span></i>
				<div class="multi-element" ng-dropdown-multiselect="" options="pickClients" extra-settings="pickDateService.settings" selected-model="pickDateService.clients"></div>
				<br />

				<b>Region:</b> <br />
				<i><span ng-repeat="item in pickDateService.regions">{{item.label}}  </span></i>
				<div class="multi-element" ng-dropdown-multiselect="" options="pickRegions" extra-settings="pickDateService.settings" selected-model="pickDateService.regions"></div>
				<br />

				<b>Speed:</b> <br />
				<i><span ng-repeat="item in pickDateService.speeds">{{item.label}}  </span></i>
				<div class="multi-element" ng-dropdown-multiselect="" options="pickSpeeds" extra-settings="pickDateService.settings" selected-model="pickDateService.speeds"></div>
				<br />

				<b>Our Ref:</b> <br />
				<i><span ng-repeat="item in pickDateService.ourRefs">{{item}}  </span></i>
				<div class="multi-element" ng-dropdown-multiselect="" options="pickOurRefs" extra-settings="pickDateService.stringSettings" selected-model="pickDateService.ourRefs"></div>
				<br />
			 </div>

			  <div class="col-md-6">
				<div pickadate ng-model="pickDateService.date"></div>
			  </div>
		  </div>

		  <div class="row rb-footer-row">
		    <div class="col-md-12 rb-footer-actions">
					<div class="btn btn-default" ng-click="cancelPickDateService()">Cancel</div>
					<div class="btn btn-primary" ng-click="doPickDateService()">Done</div>
			  </div>
		  </div>
        </div>
      </div>




    </div>



</div>

{{dateService}}
