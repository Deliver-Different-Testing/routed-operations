<div class="dateServiceForm" ng-show="dateService == 1">
    <div class="dateService">
      
      <div class="container-fluid">
		 <div class="row">
				<div class="col-md-6">
				   Select Client: <br />
				<div class="multi-element" ng-dropdown-multiselect="" options="pickClients" extra-settings="pickDateService.settings" selected-model="pickDateService.clients"></div>
				<br />

           		<!--<div class="col-md-6">
				Select Service: <br />
				<div class="multi-element" ng-dropdown-multiselect="" options="pickServices" extra-settings="pickDateService.settings" selected-model="pickDateService.service"></div>
				<br />
				Select Region: <br />
				<div class="multi-element" ng-dropdown-multiselect="" options="pickRegions" extra-settings="pickDateService.settings" selected-model="pickDateService.region"></div>
				<br />
				Select Job Status: <br />
				<div class="multi-element" ng-dropdown-multiselect="" options="pickStatuses" extra-settings="pickDateService.settings" selected-model="pickDateService.status"></div>
				<br />
				 -->

				<br />
				<!--	<div class="btn btn-primary" ng-click="doPickDateService()">Done</div>  -->
			 </div>

			  <div class="col-md-6">
				<div pickadate ng-model="pickDateService.date"></div>
			  </div>

		   	<!-- <div class="col-md-6">
			 <div pickadate ng-model="pickDateService.date"></div>
			 <br />
			 <br />
             <div class="btn btn-primary" ng-click="doPickDateService()">Done</div>
          </div>   -->
		  </div>
		  <div class="row">
		    <div class="col-md-6">
							<br />
					<div class="btn btn-primary" ng-click="doPickDateService()">Done</div>
			  </div>
		  </div>
        </div>		
      </div>


    

    </div>



</div>

{{dateService}}