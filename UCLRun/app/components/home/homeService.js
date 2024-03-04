angular
	.module('uRuns')
	.factory('uRunData', ['$http', function($http) {
	    return {
	      getJobs: function() {
	        return $http.get('app/components/home/api/jobsList.php').then(function(response) {
	         return response.data;
	        });
			//return "Working :)";
	      },
	      getDateService: function() {
	          //return $http.get('app/components/home/api/runTypes.json').then(function(response) {
	          //    return response.data;
	          //});
	          ////return "Working :)";
	          // JobController/RunBuilderSettings
	          return $http.get('/Job/GetRunSettings').then(function(response) {
	              return response.data;
	          });
	      },
        getRegionList: function (runDate) {
            return $http.get('/Job/RegionList?runDate=' + runDate.toISOString()).then(function (response) {
                return response.data;
            });
        },
	      getRunJobs: function() {
	        return $http.get('app/components/home/api/jobsRunList.php').then(function(response) {
	         return response.data;
	        });
			//return "Working :)";
	      },
	      getRunJobsAll: function(date,clientIds) {
              // JobController/Index
	          return $http.get('/Job?datetime='+ date.toISOString() + '&clientIds=' + clientIds).then(function(response) {
	              return response.data.BulkJobs;
	          });

	        //return $http.get('app/components/home/api/jobsRunList.json').then(function(response) {
	        // return response.data;
	        //});
			//return "Working :)";
	      },
	      getJobsGrouped: function() {
	        return $http.get('app/components/home/api/jobsGroupedList.json').then(function(response) {
	         return response.data;
	        });
			//return "Working :)";
	      },
	      getPotentialCouriers: function() {
	          // JobController/Index
	          return $http.get('/Courier').then(function(response) {
	              return response.data.PotentialCouriers;
	          });
	        //return $http.get('app/components/home/api/potentialCouriers.json').then(function(response) {
	        // return response.data;
	        //});
			//return "Working :)";
	      },
	      doGetAPI: function(path, data) {
	          //return $http.post('app/components/home/api/api.php', data).then(function(response) {
	          return $http.get(path, data).then(function(response) {
	              return response.data;
	          });

	          //return "Working :)";
	      },
	      doAPI: function(path, data) {
	        //return $http.post('app/components/home/api/api.php', data).then(function(response) {
	          return $http.post(path, data).then(function(response) {
	            return response.data;
	        });

			//return "Working :)";
	      },
	      getJobsFilter: function(data) {
	        return $http.post('app/components/home/api/jobsList.php', data).then(function(response) {
	         return response.data;
	        });

			//return "Working :)";
	      },
          getRouteSavvy:function(data) {
              //return $http.get('app/components/home/api/routeSavvyResult.json').then(function(response) {
              //    return response.data;
              //});
	          return $http.post('/Route', data).then(function(response) {
	              return response.data;
	          });

	          //return "Working :)";
	      },
	      getRouteSavvyWithName:function(data) {
	          //return $http.get('app/components/home/api/routeSavvyResult.json').then(function(response) {
	          //    return response.data;
	          //});
	          return $http.post('/Route/RouteWithName', data).then(function(response) {
	              return response.data;
	          });

	          //return "Working :)";
	      }
	    };
  	}])   