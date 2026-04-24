angular
    .module('uRuns')
    .factory('uRunData', ['$http', function ($http) {
        return {
            bulkUpdateRouteDate: function (data) {
                return $http.post('/Job/BulkUpdateRouteDate', data).then(function (response) {
                    return response.data;
                });
            },
            getJobs: function () {
                return $http.get('app/components/home/api/jobsList.php').then(function (response) {
                    return response.data;
                });
                //return "Working :)";
            },
            getDateService: function () {
                //return $http.get('app/components/home/api/runTypes.json').then(function(response) {
                //    return response.data;
                //});
                ////return "Working :)";
                // JobController/RunBuilderSettings
                return $http.get('/Job/GetRunSettings').then(function (response) {
                    return response.data;
                });
            },
            syncHDJobs: function (date) {
                return $http.post('/Job/SyncHDJobs?runDate=' + date.format("YYYY-MM-DD")).then(function (response) {
                    return response.data;
                });
            },
            getRegionList: function (runDate) {
                return $http.get('/Job/RegionList?runDate=' + runDate.format("YYYY-MM-DD")).then(function (response) {
                    return response.data;
                });
            },
            getSpeedList: function (runDate) {
                return $http.get('/Job/SpeedList?runDate=' + runDate.format("YYYY-MM-DD")).then(function (response) {
                    return response.data;
                });
            },
            getAllSpeeds: function () {
                return $http.get('/Job/AllSpeeds').then(function (response) {
                    return response.data;
                });
            },
            getFilter: function (runDate) {
                return $http.get('/Job/GetFilter?runDate=' + runDate.format("YYYY-MM-DD")).then(function (response) {
                    return response.data;
                });
            },
            getRunJobs: function () {
                return $http.get('app/components/home/api/jobsRunList.php').then(function (response) {
                    return response.data;
                });
                //return "Working :)";
            },
            getRunJobsAll: function (date, clientIds, regionIds, ourRefs, speeds) {
                // JobController/Index
                return $http.get('/Job?datetime=' + date.format("YYYY-MM-DD") + '&clientIds=' + clientIds + '&regionIds=' + regionIds + "&ourRefs=" + ourRefs + "&speeds=" + speeds).then(function (response) {
                    return response.data.BulkJobs;
                });

                //return $http.get('app/components/home/api/jobsRunList.json').then(function(response) {
                // return response.data;
                //});
                //return "Working :)";
            },
            getJobsGrouped: function () {
                return $http.get('app/components/home/api/jobsGroupedList.json').then(function (response) {
                    return response.data;
                });
                //return "Working :)";
            },
            getPotentialCouriers: function () {
                // JobController/Index
                return $http.get('/Courier').then(function (response) {
                    return response.data.PotentialCouriers;
                });
                //return $http.get('app/components/home/api/potentialCouriers.json').then(function(response) {
                // return response.data;
                //});
                //return "Working :)";
            },
            doGetAPI: function (path, data) {
                //return $http.post('app/components/home/api/api.php', data).then(function(response) {
                return $http.get(path, data).then(function (response) {
                    return response.data;
                });

                //return "Working :)";
            },
            doAPI: function (path, data) {
                //return $http.post('app/components/home/api/api.php', data).then(function(response) {
                return $http.post(path, data).then(function (response) {
                    return response.data;
                });

                //return "Working :)";
            },
            getJobsFilter: function (data) {
                return $http.post('app/components/home/api/jobsList.php', data).then(function (response) {
                    return response.data;
                });

                //return "Working :)";
            },
            getRouteSavvy: function (data) {
                //return $http.get('app/components/home/api/routeSavvyResult.json').then(function(response) {
                //    return response.data;
                //});
                return $http.post('/Route', data).then(function (response) {
                    return response.data;
                });

                //return "Working :)";
            },
            getRouteSavvyWithName: function (data) {
                //return $http.get('app/components/home/api/routeSavvyResult.json').then(function(response) {
                //    return response.data;
                //});
                return $http.post('/Route/RouteWithName', data).then(function (response) {
                    return response.data;
                });

                //return "Working :)";
            },
            getHereMapSequence: function (data) {
                return $http.post('/Route/GetHereMapSequence', { requestData: data }).then(function (response) {
                    return response.data;
                });


                //return $http.jsonp(data).then(function (response) {
                //    return response.data;
                //});
            },
            updateJobToRun: function (data) {
                return $http.post('/Job/UpdateJobToRun', data).then(function (response) {
                    return response.data;
                });
            },
            removeJobFromRun: function(data) {
                return $http.post('/Job/DeleteBulkJobRun', data).then(function (response) {
                    return response.data;
                });
            },
            voidJobs: function (data) {
                return $http.post('/Job/VoidJobs', data).then(function (response) {
                    return response.data;
                });
            }
        };
    }]);   