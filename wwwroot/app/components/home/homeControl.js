angular
    .module('uRuns')
    .controller('HomeControl', ['$scope', 'uRunData', "$state", "$filter", '$parse', "hotkeys", 'NgMap', 'GeoCoder', '$timeout', '$q', '$ngConfirm', function ($scope, uRunData, $state, $filter, $parse, hotkeys, NgMap, GeoCoder, $timeout, $q, $ngConfirm) {

        NgMap.getMap().then(function (map) {
            $scope.map = map;
            $scope.marker = map.markers[0];
        });

        $scope.gather = {
            submit: function () {
                $scope.gather.form.onSubmit();
                $(".gatherForm").hide();

            },
            cancel: function () {
                $(".gatherForm").hide();
            },
            showForm: function () {
                $(".gatherForm").show(0, function () {
                    //setTimeout(function () { $(".gatherForm .focusMe").focus(); }, 0);
                    // This will force the scopde to be updated to prevent missing data in the scope
                    $timeout(function () { $(".gatherForm .focusMe").focus(); }, 0);
                });
            },
            submitValue: "Save"
        };

        $scope.options = {
            "detail": {
                "size": [
                    {
                        "id": 1,
                        "label": "Car"
                    },
                    {
                        "id": 2,
                        "label": "Bike"
                    },
                    {
                        "id": 3,
                        "label": "Truck"
                    },
                    {
                        "id": 4,
                        "label": "Van"
                    }
                ]
            }
        };


        $scope.boxes = {
            "jobsList": {
                "title": "Jobs List",
                "tpl": "app/components/home/tpls/jobList.tpl",
                "showSearch": 1,
                "model": "jobList",
                "headings": [
                    {
                        "label": "Client",
                        "name": "ClientCode"
                    },
                    {
                        "label": "Job #",
                        "name": "JobNumber"
                    },
                    {
                        "label": "D Date",
                        "name": "DeliveryDate"
                    },
                    {
                        "label": "R Time",
                        "name": "ReadyTime"
                    },
                    {
                        "label": "To",
                        "name": "ToAddress"
                    },
                    {
                        "label": "Suburb",
                        "name": "ToSuburb"
                    },
                    //{
                    //	"label":"> 100",
                    //	"name":"RunMoreThan100"
                    //},
                    {
                        "label": "ZipCode",
                        "name": "ToPostCode"
                    },
                    {
                        "label": "Courier",
                        "name": "CourierID"
                    },
                    {
                        "label": "Speed",
                        "name": "SpeedID"
                    }
                ]
            },
            "jobDetail": {
                "title": "Detail",
                "tpl": "app/components/home/tpls/jobDetail.tpl",
                "showSearch": 0,
                "showDetailButtons": 1
            },
            "potentialCourierFleets": {
                "title": "Courier Fleets",
                "tpl": "app/components/home/tpls/potentialCourierFleets.tpl",
                "showSearch": 0
            },
            "potentialCouriers": {
                "title": "Couriers",
                "tpl": "app/components/home/tpls/potentialCouriers.tpl",
                "showSearch": 0
            },
            "groupedJobs": {
                "title": "Grouped Jobs",
                "tpl": "app/components/home/tpls/groupedJobs.tpl",
                "showSearch": 1
            },
            "runList": {
                "title": "Run List",
                "tpl": "app/components/home/tpls/runList.tpl",
                "showSearch": 0
            },
            "runBuilder": {
                "title": "Run - ",
                "tpl": "app/components/home/tpls/runBuilder.tpl",
                "showSearch": 0,
                "model": "runBuilder",
                "headings": [
                    {
                        "label": "Client",
                        "name": "ClientCode"
                    },
                    {
                        "label": "Job #",
                        "name": "JobNumber"
                    },
                    {
                        "label": "D Date",
                        "name": "DeliveryDate"
                    },
                    {
                        "label": "R Time",
                        "name": "ReadyTime"
                    },
                    {
                        "label": "To",
                        "name": "ToAddress"
                    },
                    {
                        "label": "Suburb",
                        "name": "ToSuburb"
                    },
                    //{
                    //	"label":"> 100",
                    //	"name":"RunMoreThan100"
                    //},
                    {
                        "label": "ZipCode",
                        "name": "ToPostCode"
                    },
                    {
                        "label": "Courier",
                        "name": "CourierID"
                    },
                    {
                        "label": "Speed",
                        "name": "SpeedID"
                    }

                ]
            },
            //"map": {
            //    "title": "Google Map",
            //    "tpl": "app/components/home/tpls/map.tpl",
            //    "showSearch": 0
            //}
            "map": {
                "title": "Here Map",
                "tpl": "app/components/home/tpls/HereMap.tpl",
                "showSearch": 0
            }
        };

        ///////////////////////////////
        // LAYOUT 
        ///////////////////////////////
        $scope.layouts = [
            {
                name: "Default",
                layout: {
                    "columns": [
                        {
                            "id": "col1",
                            "width": "600px",
                            "boxes": [
                                {

                                    "name": "groupedJobs",
                                    "height": "300px"
                                },
                                {
                                    "name": "jobsList",
                                    "height": "300px"
                                },
                                {
                                    "name": "jobDetail"
                                }
                            ]
                        },
                        {
                            "id": "col2",
                            "width": "400px",
                            "boxes": [
                                {

                                    "name": "runList",
                                    "height": "250px"
                                },
                                {

                                    "name": "runBuilder"
                                }
                            ]
                        },
                        {
                            "id": "col3",
                            "width": "140px",
                            "boxes": [
                                {
                                    "name": "potentialCourierFleets",
                                    "height": "300px"
                                },
                                {
                                    "name": "potentialCouriers",
                                }
                            ]
                        },
                        {
                            "id": "col4",
                            "boxes": [
                                {
                                    "name": "map"
                                }
                            ]
                        }
                    ]
                }
            }
        ];


        $scope.groupJobsSelection = "";
        $scope.currentWorkSelection = "";
        $scope.potentialCourierFleetsSelection = "";
        $scope.potentialCouriersSelection = "";

        $scope.layout = angular.copy($scope.layouts[0].layout);

        $scope.loadLayout = function (i) {
            $scope.layout = angular.copy($scope.layouts[i].layout, function () {
                setTimeout(sizeHeadings(), 1000);

            });
            //$scope.$apply();
        };

        $scope.saveLayout = function () {


            angular.forEach($scope.layout.columns, function (column, colKey) {
                column.width = $("#co-" + column.id).css("flex-basis");
                angular.forEach(column.boxes, function (box, boxKey) {
                    box.height = $("#box-" + box.name).css("flex-basis");
                });
            });


            $scope.gather.form = {
                id: "saveLayout",
                title: "Save Layout",
                fields: [
                    {
                        "name": "layoutName",
                        "label": "Layout Name",
                        "value": ""
                    }
                ],
                onSubmit: function () {

                    var layoutName = $("#saveLayout").find("input").val();

                    var callData = {
                        "call": "saveLayout",
                        "layoutName": layoutName,
                        "layout": $scope.layout
                    }

                    //DO THE API CALL
                    uRunData.doAPI(callData).then(function (data) {

                        //console.log(data);

                        if (data.response === "Success") {

                            $scope.layouts = $scope.layouts.concat(
                                {
                                    name: layoutName,
                                    layout: angular.copy($scope.layout)
                                }
                            );

                        } else {

                            alert("Critial Error");

                        }

                    });





                },
                submitValue: "Save"
            };

            $scope.gather.showForm();

        };

        $scope.sortableOptions = {
            connectWith: ".column-sortable",
            items: '.box',
            placeholder: "placeholder",
            scroll: true,
            scrollSensitivity: 100,
            scrollSpeed: 20,
            handle: '.box-handle',
            activate: function (e, ui) {
                var box = $("#" + ui.item.context.id);
                var parent = box.parent();
                parent.find(".box").each(function () {
                    $(this).attr("data-height", $(this).height() + "px");
                });
            },
            update: function (e, ui) {
                setTimeout(function () {
                    var box = $("#" + ui.item.context.id);
                    var parent = box.parent();
                    parent.find(".box").each(function () {
                        $(this).css({ "flex-basis": $(this).attr("data-height") });
                    });
                    parent.find(".box").last().css({ "flex-basis": "0" });
                }, 0);
            }
        };

        $scope.openSearch = function (boxID) {

            if ($("#box-" + boxID).find(".box-search").hasClass("open")) {

                $("#box-" + boxID).find(".box-search input").fadeOut(function () {

                    $("#box-" + boxID).find(".box-search").removeClass("open");
                    $("#box-" + boxID).find(".box-search").animate({ "width": "31px" }, 500);

                });

            } else {

                $("#box-" + boxID).find(".box-search").animate({ "width": "200px" }, 500, function () {
                    $("#box-" + boxID).find(".box-search").addClass("open");
                    $("#box-" + boxID).find(".box-search input").fadeIn();
                });

            }

        };


        //Column Sorting
        $scope.sort = [];
        $scope.orderList = function (list, prop) {


            if ($scope.sort[list] !== prop) {
                $scope.sort[list] = prop;
                $scope[list] = $filter('orderBy')($scope[list], prop);
            } else {
                $scope.sort[list] = "d-" + prop;
                $scope[list] = $filter('orderBy')($scope[list], "-" + prop);
            }

            if (list === "runbuilder") {
                $filter('filter')($scope.runList, { 'isActive': 1 })[0].jobs = $scope.runBuilder;
            }

        };

        $scope.pickDateService = {
            "clients": [],
            "regions": [],
            "ourRefs": [],
            "service": [],
            "status": [],
            "speeds": [],
            "settings": {
                "enableSearch": true,
                "selectedToTop": true,
                "scrollableHeight": '300px',
                "scrollable": true
            },
            "stringSettings": {
                "template": '{{option}}',
                smartButtonTextConverter(skip, option) { return option; },
                "enableSearch": true,
                "selectedToTop": true,
                "scrollableHeight": '300px',
                "scrollable": true
            },
            "date": moment().format("YYYY-MM-DD")
        };

        // Refresh the ourRef list
        $scope.$watch('pickDateService.date', function (newValue, oldValue, scope) {
            $scope.getFilter();
            $scope.getSpeeds();
        }, true);

        $scope.doPickDateService = function () {
            //console.log("bro");
            //console.log($scope.pickDateService);
            $scope.dateService = 0;
            $scope.getData(1);
        };

        $scope.openPickDateService = function () {
            $scope.dateService = 1;
            $('.dateServiceForm').show();
            //console.log("happening");
        };

        $scope.cancelPickDateService = function () {
            $scope.dateService = 0;
            $('.dateServiceForm').hide();
        };

        uRunData.getDateService().then(function (data) {
            //    $scope.pickServices = data.services;
            //    $scope.pickRegions = data.regions;
            //    $scope.pickStatuses = data.statuses;
            $scope.pickClients = data.response.clients;
            $scope.getFilter();
            $scope.getRegions();
            $scope.getSpeeds();
        });

        $scope.getFilter = function () {
            uRunData.getFilter(moment($scope.pickDateService.date)).then(function (data) {
                $scope.pickOurRefs = data.OurRefs;
            });
        }

        $scope.getRegions = function () {
            uRunData.getRegionList(moment($scope.pickDateService.date)).then(function (data) {
                $scope.pickRegions = data;
            });
        };

        $scope.getSpeeds = function () {
            uRunData.getSpeedList(moment($scope.pickDateService.date)).then(function (data) {
                $scope.pickSpeeds = data;
            });
        };

        // Load all available speeds (full list from tucJobType)
        $scope.allSpeeds = [];
        $scope.loadAllSpeeds = function () {
            uRunData.getAllSpeeds().then(function (data) {
                $scope.allSpeeds = data;
            });
        };
        $scope.loadAllSpeeds();

        // Build speed options array for the select dropdown in editDetailField
        $scope.getSpeedOptions = function () {
            if (!$scope.allSpeeds || $scope.allSpeeds.length === 0) return [];
            return $scope.allSpeeds.map(function (s) {
                return { id: s.id, label: s.label };
            });
        };

        // Get speed label from speed ID for display
        $scope.getSpeedLabel = function (speedId) {
            if (!speedId) return speedId;
            if ($scope.allSpeeds && $scope.allSpeeds.length > 0) {
                var speed = $scope.allSpeeds.find(function (s) { return s.id == speedId; });
                if (speed) return speed.label;
            }
            return speedId;
        };

        // Sync EH and HD jobs by creating a copy of bulk job with JobID
        $scope.syncHDJobs = function () {
            if (confirm('Do you want to sync all EH/HD jobs from live?')) {
                uRunData.syncHDJobs(moment($scope.pickDateService.date)).then(function (data) {
                    $scope.getData(1);
                });
            }
        }

        ///////////////////////////
        // HOTKEYS 
        //////////////////////////

        hotkeys.add({
            combo: 'ctrl+d',
            description: 'Dispatch selected jobs',
            allowIn: ['INPUT', 'SELECT', 'TEXTAREA'],
            callback: function () {
                if ($(".activeTable .active").length > 0) {
                    $scope.dispatchJobsForm();
                }
            }
        });

        hotkeys.add({
            combo: 'esc',
            description: 'Close gather screen',
            allowIn: ['INPUT', 'SELECT', 'TEXTAREA'],
            callback: function () {
                $(".gatherForm").hide();
                $(".eventForm").hide();
                $scope.pickDateService = 0;
            }
        });

        hotkeys.add({
            combo: 'ctrl+a',
            description: 'Select All',
            allowIn: ['INPUT', 'SELECT', 'TEXTAREA'],
            callback: function () {
                $(".activeTable").find(".clickable-row").addClass("active");
            }
        });

        hotkeys.add({
            combo: 'enter',
            description: 'Submit gather form',
            allowIn: ['INPUT', 'SELECT', 'TEXTAREA'],
            callback: function () {
                setTimeout($scope.gather.submit(), 0);
            }
        });

        hotkeys.add({
            combo: 'del',
            description: 'Delete from run builder',
            allowIn: ['INPUT', 'SELECT', 'TEXTAREA'],
            callback: function () {
                setTimeout(function () {

                    $("#runBuilder").find(".active").each(function () {
                        $(this).find(".delete-row").click();
                    });


                }, 0);
            }
        });

        ////////////////////////////////////////
        // LOAD DISPATCH JOBS SCREEN
        ///////////////////////////////////////
        $scope.dispatchJobsForm = function () {
            $scope.gather.form = {
                id: "dispatchJobs",
                title: "Dispatch Jobs",
                fields: [
                    {
                        "name": "courierNumber",
                        "label": "Courier number...",
                        "value": ""
                    }
                ],
                onSubmit: function () {
                    $scope.dispatchJobs($("#gather-courierNumber").val());
                },
                submitValue: "Dispatch"
            };
            $scope.gather.showForm();

        };

        ////////////////////////////////////////
        // DISPATCH THE JOBS
        ///////////////////////////////////////
        $scope.dispatchJobs = function (courier) {

            var callData = {
                "call": "dispatchJobs",
                "courier": courier,
                "jobs": []
            };

            $(".activeTable .active").each(function () {
                callData.jobs.push($(this).attr("data-jobid"));
            });

            //DO THE API CALL
            uRunData.doAPI(callData).then(function (data) {

                //console.log(data);
                if (data.response === "Success") {

                    var list = $(".activeTable").attr("id");

                    setTimeout(function () {
                        $(".activeTable .active").each(function () {
                            //$(this).hide();
                            $(this).find(".selectjob").click();

                            var index = $scope[list].indexOf($scope.jobToRunBuilder);
                            //console.log(index);
                            $scope[list].splice(index, 1);
                            $scope.$apply();
                        });
                    }, 0);

                    if ($(".activeTable").attr("data-group") === "jobsGrouped") {
                    } else {
                        $scope.currentJob = false;
                        $scope.currentCourier = false;
                        $scope.courierFleets = false;
                        $scope.potentialCouriers = false;
                        $scope.jobGroups = false;
                        $scope.jobsCurrentList = false;
                    }

                } else {

                    alert("Critial Error");

                }

            });

        };



        ////////////////////////////
        // POTENTIAL COURIERS
        ////////////////////////////

        // 	$scope.getPotentialCouriers = function() {

        // 		$("#box-potentialCouriers .loading").show();
        //	uRunData.getPotentialCouriers($scope.selectedJobs).then(function(data) {
        //		$scope.potentialCouriers = data;

        //		//Set headings
        //		setTimeout(function(){ sizeHeadings($("#potentialCouriers").parents(".column")); }, 1000);
        //		setTimeout(function(){ sizeHeadings($("#potentialCouriers").parents(".column")); }, 2000);

        //		$("#box-potentialCouriers .loading").fadeOut();

        //	});

        //}

        $scope.getPotentialCouriers = function () {
            $("#box-potentialCourierFleets .loading").show();
            uRunData.getPotentialCouriers($scope.selectedJobs).then(function (data) {

                var members = data;
                $scope.couriers = data;

                var groups = members.reduce(function (obj, item) {
                    obj[item.Fleet] = obj[item.Fleet] || [];
                    obj[item.Fleet].push(item);
                    return obj;
                }, {});

                var myArray = Object.keys(groups).map(function (key) {
                    return { name: key, couriers: groups[key] };
                });

                $scope.fleetGroups = myArray;
                $scope.courierFleets = true;


                //Set headings
                setTimeout(function () { sizeHeadings($("#potentialCouriers").parents(".column")); }, 1000);
                setTimeout(function () { sizeHeadings($("#potentialCouriers").parents(".column")); }, 2000);

                $("#box-potentialCourierFleets .loading").fadeOut();


            });
        };

        $scope.showCouriers = function (fleet) {

            $("#box-potentialCouriers .loading").show();
            $scope.potentialCouriers = fleet.couriers;
            setTimeout(function () { sizeHeadings($("#potentialCouriers").parents(".column")); }, 1000);
            $("#box-potentialCouriers .loading").fadeOut();

        };

        //////////////////////////////
        /// RUN BUILDER 
        //////////////////////////////

        $scope.defaultRun = [];
        $scope.runTotals = {};


        $scope.activateRunDrop = function () {
            setTimeout(function () {

                $(document).ready(function (event) {
                    $(".droppable-box").droppable({
                        classes: {
                            "ui-droppable-hover": "active"
                        },
                        drop: function (event, ui) {
                            //$(this).addClass("active");

                            $(".activeTable .active").each(function () {

                                $(this).find(".selectjob").click();

                            });

                            $scope.updateRun();

                        }
                    });
                });

            }, 0);

        };

        $scope.updateRun = function (manualRoute) {
            $scope.defaultRunID = null;
            $scope.defaultRun = [];
            $scope.defaultRunStart = null;
            $scope.defaultRunEnd = null;
            $scope.defaultRouteResponse = null;

            if (typeof $filter('filter')($scope.runList, { 'isActive': 1 })[0] !== 'undefined') {
                //Refresh the run list 
                $filter('filter')($scope.runList, { 'isActive': 1 })[0].jobs = $scope.runBuilder;
                $scope.defaultRunID = $filter('filter')($scope.runList, { 'isActive': 1 })[0].ID;
            }

            angular.forEach($scope.runBuilder, function (value, key) {

                //URGENT HQ, change start from the first Pickup from address
                //$scope.defaultRunStart = {lat: -36.9227077, lng: 174.81272650000005}

                // Use the first from lat and lng
                if (key === 0) {
                    $scope.defaultRunStart = { lat: value.fromLat, lng: value.fromLng };
                }

                if (value.isEnd === 1) {

                    $scope.defaultRunEnd = { lat: value.toLat, lng: value.toLng }

                } else if (value.toLat && value.toLng) {
                    $scope.defaultRun.push({ lat: value.toLat, lng: value.toLng });
                }

            });


            if ($scope.defaultRunEnd === null) {
                $scope.defaultRunEnd = angular.copy($scope.defaultRun[$scope.defaultRun.length - 1]);
                $scope.defaultRun.splice($scope.defaultRun.length - 1, 1);
            }

            $scope.updatePotentialJobs(manualRoute);
        };


        $scope.transferToAnotherRunFromMap = function (jobID, fromRunID) {

            // remove the self run from the list
            var options = $scope.multiSelectedRuns.filter(x => x.id != fromRunID);

            $scope.gather.form = {
                id: "transferToRun",
                title: "Transfer to Run",
                fields: [
                    {
                        "name": "transferToRunName",
                        "type": "select",
                        "options": options, //$scope.multiSelectedRuns,
                        "jobID": jobID,
                        "fromRunID": fromRunID
                    }
                ],
                onSubmit: function () {
                    $scope.updateJobToRun($scope.gather.form.fields[0].jobID, $scope.gather.form.fields[0].fromRunID, $scope.gather.form.fields[0].value);
                },
                submitValue: "Transfer Job"
            }

            $scope.gather.showForm();
        }

        $scope.updateJobToRun = function (jobID, fromRunID, toRunID) {
            $scope.jobToTransfer = { jobID: jobID, fromRunID: fromRunID, runID: toRunID };
            // Update job with the new runID
            uRunData.updateJobToRun($scope.jobToTransfer).then(function (data) {

                var jobToUpdateFromRun = $filter('filter')($scope.runJobsAll, { 'BulkJobID': $scope.jobToTransfer.jobID }, true)[0];
                jobToUpdateFromRun.BulkJobRunID = $scope.jobToTransfer.jobID;

                // remove job from the old run 
                var fromRunList = $filter('filter')($scope.runList, { 'ID': $scope.jobToTransfer.fromRunID })[0];
                fromRunList.jobs.splice(fromRunList.jobs.indexOf(jobToUpdateFromRun), 1);

                // add job into the new run
                var toRunList = $filter('filter')($scope.runList, { 'ID': $scope.jobToTransfer.runID })[0];
                toRunList.jobs.push(jobToUpdateFromRun);

                $scope.jobToTransfer = {};
                $scope.updateRun();
            });
        }

        $scope.addToRunFromMap = function (lat, lng, jn, jobID, toRunID) {

            $scope.runBuilder.push($filter('filter')($scope.jobList, { 'JobNumber': jn })[0]);

            $filter('filter')($scope.runJobsAll, { 'JobNumber': jn })[0].inBuilder = 1;
            $filter('filter')($scope.jobList, { 'JobNumber': jn })[0].inBuilder = 1;
            $filter('filter')($scope.runBuilder, { 'JobNumber': jn })[0].inBuilder = 1;

            // if add to run ID is not null, then add this job into the lock run
            if (toRunID) {
                // Update job with the new runID
                uRunData.updateJobToRun({ jobID: jobID, runID: toRunID }).then(function (data) {
                    $scope.updateRun();
                });
            } else {
                $scope.updateRun();
            }
        };

        $scope.selectJobFromMap = function (lat, lng) {

            var toCompare = [];

            angular.forEach($scope.runBuilder, function (job, key) {
                toCompare.push([key, job.toLat, job.toLng]);
            });

            var closestIndex = closestLocation(lat, lng, toCompare);

            var closestJob = $scope.runBuilder[closestIndex[0]];

            $("#runBuilder").find(".active").removeClass("active");

            var $parentDiv = $("#job-" + closestJob.JobNumber).parents(".box-content");
            var $innerListItem = $("#job-" + closestJob.JobNumber);

            $("#job-" + closestJob.JobNumber).addClass("active").click();
        }


        $scope.removeJobFromMap = function (lat, lng, jobID) {
            //var toCompare = [];

            //angular.forEach($scope.runBuilder, function (job, key) {
            //    toCompare.push([key, job.toLat, job.toLng]);
            //});

            //var closestIndex = closestLocation(lat, lng, toCompare);

            //var closestJob = $scope.runBuilder[closestIndex[0]];

            //$scope.deleteFromRun(closestJob, 1);

            var jobToRemoveFromRun = $filter('filter')($scope.runJobsAll, { 'BulkJobID': jobID }, true)[0];
            jobToRemoveFromRun.inBuilder = 0;
            jobToRemoveFromRun.BulkJobRunID = 0;

            var index = $scope.runBuilder.indexOf(jobToRemoveFromRun);
            if (index >= 0) {
                $scope.deleteFromRun(jobToRemoveFromRun, 1);
            }
        }


        $scope.setJobEndFromMap = function (lat, lng) {

            var toCompare = [];

            angular.forEach($scope.runBuilder, function (job, key) {
                toCompare.push([key, job.toLat, job.toLng]);
            });

            var closestIndex = closestLocation(lat, lng, toCompare);

            var closestJob = $scope.runBuilder[closestIndex[0]];

            if ($filter('filter')($scope.runBuilder, { 'isEnd': 1 })[0]) {
                $filter('filter')($scope.runBuilder, { 'isEnd': 1 })[0].isEnd = 0;
            }

            closestJob.isStart = 0;
            closestJob.isEnd = 1;
            $scope.updateRun(1); // manualRoute = 1

        };



        $scope.setJobStartFromMap = function (lat, lng) {

            var toCompare = [];

            angular.forEach($scope.runBuilder, function (job, key) {
                toCompare.push([key, job.toLat, job.toLng]);
            });

            var closestIndex = closestLocation(lat, lng, toCompare);

            var closestJob = $scope.runBuilder[closestIndex[0]];

            if ($filter('filter')($scope.runBuilder, { 'isStart': 1 })[0]) {
                $filter('filter')($scope.runBuilder, { 'isStart': 1 })[0].isStart = 0;
            }

            closestJob.isEnd = 0;
            closestJob.isStart = 1;
            $scope.updateRun();

        };



        $scope.runBuilderMenu = [
            // NEW IMPLEMENTATION
            {
                text: 'Toggle end point',
                click: function ($itemScope, $event, modelValue, text, $li) {

                    if ($itemScope.job.isEnd == 1) {
                        $itemScope.job.isEnd = 0;
                        $scope.updateRun();
                    } else {
                        if ($filter('filter')($scope.runBuilder, { 'isEnd': 1 })[0]) {
                            $filter('filter')($scope.runBuilder, { 'isEnd': 1 })[0].isEnd = 0;
                        }
                        $itemScope.job.isStart = 0;
                        $itemScope.job.isEnd = 1;
                        $scope.updateRun();
                    }

                }
            },
            {
                text: 'Remove',
                click: function ($itemScope, $event, modelValue, text, $li) {
                    setTimeout(function () {
                        $("#runBuilder").find(".active").each(function () {
                            $(this).find(".delete-row").click();
                        });
                    }, 0);

                }
            },
            {
                text: 'Void',
                click: function ($itemScope, $event, modelValue, text, $li) {
                    $scope.voidSelectedJobs('runBuilder', $itemScope.job);
                }
            }

        ];

        // Context menu for the Job List
        $scope.jobListMenu = [
            {
                text: 'Void',
                click: function ($itemScope, $event, modelValue, text, $li) {
                    $scope.voidSelectedJobs('jobList', $itemScope.job);
                }
            }
        ];

        // Context menu for the Void Jobs run (un-void only)
        $scope.voidRunBuilderMenu = [
            {
                text: 'Un-void',
                click: function ($itemScope, $event, modelValue, text, $li) {
                    $scope.unvoidSelectedJobs($itemScope.job);
                }
            }
        ];

        // Track if the currently active run is the Void Jobs run
        $scope.isVoidRunActive = false;

        $scope.deleteFromRun = function (job, fromBuilder) {
            var jobToRemoveFromRun = $filter('filter')($scope.runJobsAll, { 'JobNumber': job.JobNumber }, true)[0];
            jobToRemoveFromRun.inBuilder = 0;
            jobToRemoveFromRun.BulkJobRunID = 0;

            if (fromBuilder == 1) {
                var selectedRun = $filter('filter')($scope.runList, { 'name': job.RunName }, true)[0];
                if (selectedRun !== undefined && selectedRun != null && selectedRun.ID > 0) {
                    if (confirm('Are you sure you want to remove this job from the locked run?')) {
                        $scope.removeJobFromRun(job.BulkJobID);
                    }
                } else {
                    var index = $scope.runBuilder.indexOf(job);
                    $scope.runBuilder.splice(index, 1);
                    $scope.updateRun();
                }
            }
        };

        $scope.removeJobFromRun = function (jobID) {
            // Update job with the new runID
            uRunData.removeJobFromRun({ jobID: jobID }).then(function (data) {
                var jobToRemoveFromRun = $filter('filter')($scope.runJobsAll, { 'BulkJobID': jobID }, true)[0];
                jobToRemoveFromRun.inBuilder = 0;
                jobToRemoveFromRun.BulkJobRunID = 0;

                var index = $scope.runBuilder.indexOf(jobToRemoveFromRun);
                if (index >= 0) {
                    $scope.runBuilder.splice(index, 1);
                }

                $scope.updateRun();
            });
        };

        // =============================================
        // VOID JOBS FUNCTIONALITY
        // =============================================

        // Ensure the "Void Jobs" run exists in the run list when there are voided jobs.
        // Only creates/displays the run when voided jobs exist. Returns the void run or null.
        $scope.ensureVoidJobsRun = function () {
            var voidRun = $scope.runList.find(function (r) { return r.isVoidRun === true; });

            // Collect voided jobs from runJobsAll
            var voidedJobs = [];
            if ($scope.runJobsAll) {
                angular.forEach($scope.runJobsAll, function (job) {
                    if (job.Void === true || job.Void === 1) {
                        job.inBuilder = 1;
                        voidedJobs.push(job);
                    }
                });
            }

            // If no voided jobs and no existing void run with jobs, don't create one
            if (voidedJobs.length === 0 && (!voidRun || voidRun.jobs.length === 0)) {
                // Remove empty void run if it exists
                if (voidRun) {
                    var removeIdx = $scope.runList.indexOf(voidRun);
                    if (removeIdx >= 0) {
                        $scope.runList.splice(removeIdx, 1);
                    }
                }
                return null;
            }

            // Create void run if it doesn't exist
            if (!voidRun) {
                voidRun = {
                    ID: null,
                    name: "Void Jobs",
                    jobs: [],
                    mins: 0,
                    kms: 0,
                    isVoidRun: true,
                    locked: 1,
                    courier: { courier: null, Fleet: null, courierID: null },
                    status: null,
                    courierPercent: '0%',
                    revenue: 0,
                    payout: 0
                };
                $scope.runList.push(voidRun);
            } else {
                // Move to end of list if not already there
                var idx = $scope.runList.indexOf(voidRun);
                if (idx >= 0 && idx !== $scope.runList.length - 1) {
                    $scope.runList.splice(idx, 1);
                    $scope.runList.push(voidRun);
                }
            }

            // Add voided jobs that aren't already in the void run
            angular.forEach(voidedJobs, function (job) {
                var alreadyInVoidRun = voidRun.jobs.find(function (j) { return j.BulkJobID === job.BulkJobID; });
                if (!alreadyInVoidRun) {
                    voidRun.jobs.push(job);
                }
            });

            return voidRun;
        };

        // Collect selected job IDs from active rows in a table
        $scope.getSelectedJobIds = function (sourceTable, fallbackJob) {
            var selectedJobIds = [];
            $("#" + sourceTable).find("tr.active").each(function () {
                var jobId = parseInt($(this).attr("data-jobid"));
                if (jobId && !isNaN(jobId)) {
                    selectedJobIds.push(jobId);
                }
            });

            // Fallback to the right-clicked job if no active selections
            if (selectedJobIds.length === 0 && fallbackJob) {
                selectedJobIds.push(fallbackJob.BulkJobID);
            }

            return selectedJobIds;
        };

        // Main void function - handles parent/child detection and confirmation dialogs
        $scope.voidSelectedJobs = function (sourceTable, fallbackJob) {
            var selectedJobIds = $scope.getSelectedJobIds(sourceTable, fallbackJob);
            if (selectedJobIds.length === 0) return;

            // Check if any selected jobs have parent/child relationships
            var hasRelationship = false;
            var relationshipJobs = [];

            angular.forEach(selectedJobIds, function (jobId) {
                var job = $filter('filter')($scope.runJobsAll, function (j) { return j.BulkJobID === jobId; })[0];
                if (!job) return;

                // Check BulkChild (type 20) - has a parent
                if (job.JobRelationshipTypeId === 20 && job.ParentId) {
                    hasRelationship = true;
                    relationshipJobs.push({ job: job, type: 'bulkChild' });
                }
                // Check Multibox - has siblings
                else if (job.MultiboxParentID) {
                    hasRelationship = true;
                    relationshipJobs.push({ job: job, type: 'multibox' });
                }
            });

            if (hasRelationship) {
                $scope.showVoidRelationshipDialog(selectedJobIds, relationshipJobs, sourceTable);
            } else {
                $scope.executeVoid(selectedJobIds);
            }
        };

        // Show confirmation dialog for jobs with parent/child relationships
        $scope.showVoidRelationshipDialog = function (selectedJobIds, relationshipJobs, sourceTable) {
            var hasBulkChild = relationshipJobs.some(function (r) { return r.type === 'bulkChild'; });
            var hasMultibox = relationshipJobs.some(function (r) { return r.type === 'multibox'; });

            var title = 'Void Related Jobs';
            var content = '';
            var buttons = {};

            if (hasBulkChild && hasMultibox) {
                content = 'The selected job(s) have parent jobs and/or multiple parts. How would you like to proceed?';
            } else if (hasBulkChild) {
                content = 'The selected job(s) have a parent job (pickup). Would you like to void the parent job as well?';
            } else {
                content = 'The selected job(s) have multiple parts. Would you like to void all parts?';
            }

            if (hasBulkChild) {
                buttons.voidWithParent = {
                    text: 'Void Parent + Child',
                    btnClass: 'btn-red',
                    action: function () {
                        var allJobIds = selectedJobIds.slice();
                        angular.forEach(relationshipJobs, function (r) {
                            if (r.type === 'bulkChild' && r.job.ParentId) {
                                if (allJobIds.indexOf(r.job.ParentId) < 0) {
                                    allJobIds.push(r.job.ParentId);
                                }
                            }
                        });
                        // Also expand multibox siblings if applicable
                        if (hasMultibox) {
                            allJobIds = $scope.expandMultiboxSiblings(allJobIds);
                        }
                        $scope.executeVoid(allJobIds);
                    }
                };
            }

            if (hasMultibox) {
                buttons.voidAllParts = {
                    text: 'Void All Parts',
                    btnClass: 'btn-orange',
                    action: function () {
                        var allJobIds = $scope.expandMultiboxSiblings(selectedJobIds);
                        $scope.executeVoid(allJobIds);
                    }
                };
            }

            buttons.voidSelectedOnly = {
                text: hasBulkChild ? 'Void Child Only' : 'Void Selected Only',
                btnClass: 'btn-blue',
                action: function () {
                    $scope.executeVoid(selectedJobIds);
                }
            };

            buttons.cancel = {
                text: 'Cancel',
                action: function () {
                    // Do nothing
                }
            };

            $ngConfirm({
                title: title,
                content: content,
                columnClass: 'col-md-6 col-md-offset-3',
                scope: $scope,
                buttons: buttons
            });
        };

        // Expand job IDs to include all multibox siblings
        $scope.expandMultiboxSiblings = function (jobIds) {
            var expandedIds = jobIds.slice();
            angular.forEach(jobIds, function (jobId) {
                var job = $filter('filter')($scope.runJobsAll, function (j) { return j.BulkJobID === jobId; })[0];
                if (job && job.MultiboxParentID) {
                    // Find all siblings with the same MultiboxParentID
                    var siblings = $filter('filter')($scope.runJobsAll, function (j) {
                        return j.MultiboxParentID === job.MultiboxParentID;
                    });
                    angular.forEach(siblings, function (sibling) {
                        if (expandedIds.indexOf(sibling.BulkJobID) < 0) {
                            expandedIds.push(sibling.BulkJobID);
                        }
                    });
                }
            });
            return expandedIds;
        };

        // Execute the void operation via API and update UI
        $scope.executeVoid = function (jobIds) {
            uRunData.voidJobs({ JobIds: jobIds, IsVoid: true, RunDate: moment($scope.pickDateService.date).format("YYYY-MM-DD") }).then(function (data) {
                if (data.response && data.response.Success > 0) {
                    // Update job properties in the frontend
                    angular.forEach(jobIds, function (jobId) {
                        var job = $filter('filter')($scope.runJobsAll, function (j) { return j.BulkJobID === jobId; })[0];
                        if (job) {
                            job.Void = true;
                            job.JobStatus = 1000;
                            job.inBuilder = 1;

                            // Remove from any current non-void run
                            angular.forEach($scope.runList, function (run) {
                                if (!run.isVoidRun) {
                                    var idx = run.jobs.indexOf(job);
                                    if (idx >= 0) {
                                        run.jobs.splice(idx, 1);
                                    }
                                }
                            });

                            // Remove from runBuilder if currently displayed and not void run
                            if (!$scope.isVoidRunActive) {
                                var rbIdx = $scope.runBuilder.indexOf(job);
                                if (rbIdx >= 0) {
                                    $scope.runBuilder.splice(rbIdx, 1);
                                }
                            }
                        }
                    });

                    // Create/get the Void Jobs run in the frontend (backend already persisted it)
                    var voidRun = $scope.ensureVoidJobsRun();
                    // Set the DB ID from the backend response
                    if (voidRun && data.response.VoidRunId) {
                        voidRun.ID = data.response.VoidRunId;
                    }

                    $scope.updateRun();
                } else {
                    var msg = (data.response && data.response.Message) ? data.response.Message : 'Void operation failed';
                    alert(msg);
                }
            });
        };

        // Un-void selected jobs from the Void Jobs run
        // Un-void: check for parent/child relationships first, then confirm
        $scope.unvoidSelectedJobs = function (fallbackJob) {
            var selectedJobIds = $scope.getSelectedJobIds('runBuilder', fallbackJob);
            if (selectedJobIds.length === 0) return;

            // Check if any selected jobs have parent/child relationships
            var hasRelationship = false;
            var relationshipJobs = [];

            angular.forEach(selectedJobIds, function (jobId) {
                var job = $filter('filter')($scope.runJobsAll, function (j) { return j.BulkJobID === jobId; })[0];
                if (!job) return;

                // Check BulkChild (type 20) - has a parent
                if (job.JobRelationshipTypeId === 20 && job.ParentId) {
                    hasRelationship = true;
                    relationshipJobs.push({ job: job, type: 'bulkChild' });
                }
                // Check Multibox - has siblings
                else if (job.MultiboxParentID) {
                    hasRelationship = true;
                    relationshipJobs.push({ job: job, type: 'multibox' });
                }
            });

            if (hasRelationship) {
                $scope.showUnvoidRelationshipDialog(selectedJobIds, relationshipJobs);
            } else {
                $scope.executeUnvoid(selectedJobIds);
            }
        };

        // Show confirmation dialog for un-voiding jobs with parent/child relationships
        $scope.showUnvoidRelationshipDialog = function (selectedJobIds, relationshipJobs) {
            var hasBulkChild = relationshipJobs.some(function (r) { return r.type === 'bulkChild'; });
            var hasMultibox = relationshipJobs.some(function (r) { return r.type === 'multibox'; });

            var title = 'Un-void Related Jobs';
            var content = '';
            var buttons = {};

            if (hasBulkChild && hasMultibox) {
                content = 'The selected job(s) have parent jobs and/or multiple parts. How would you like to proceed?';
            } else if (hasBulkChild) {
                content = 'The selected job(s) have a parent job (pickup). Would you like to un-void the parent job as well?';
            } else {
                content = 'The selected job(s) have multiple parts. Would you like to un-void all parts?';
            }

            if (hasBulkChild) {
                buttons.unvoidWithParent = {
                    text: 'Un-void Parent + Child',
                    btnClass: 'btn-green',
                    action: function () {
                        var allJobIds = selectedJobIds.slice();
                        angular.forEach(relationshipJobs, function (r) {
                            if (r.type === 'bulkChild' && r.job.ParentId) {
                                if (allJobIds.indexOf(r.job.ParentId) < 0) {
                                    allJobIds.push(r.job.ParentId);
                                }
                            }
                        });
                        if (hasMultibox) {
                            allJobIds = $scope.expandMultiboxSiblings(allJobIds);
                        }
                        $scope.executeUnvoid(allJobIds);
                    }
                };
            }

            if (hasMultibox) {
                buttons.unvoidAllParts = {
                    text: 'Un-void All Parts',
                    btnClass: 'btn-orange',
                    action: function () {
                        var allJobIds = $scope.expandMultiboxSiblings(selectedJobIds);
                        $scope.executeUnvoid(allJobIds);
                    }
                };
            }

            buttons.unvoidSelectedOnly = {
                text: hasBulkChild ? 'Un-void Child Only' : 'Un-void Selected Only',
                btnClass: 'btn-blue',
                action: function () {
                    $scope.executeUnvoid(selectedJobIds);
                }
            };

            buttons.cancel = {
                text: 'Cancel',
                action: function () {
                    // Do nothing
                }
            };

            $ngConfirm({
                title: title,
                content: content,
                columnClass: 'col-md-6 col-md-offset-3',
                scope: $scope,
                buttons: buttons
            });
        };

        // Execute the un-void operation via API and update UI
        $scope.executeUnvoid = function (jobIds) {
            uRunData.voidJobs({ JobIds: jobIds, IsVoid: false, RunDate: moment($scope.pickDateService.date).format("YYYY-MM-DD") }).then(function (data) {
                if (data.response && data.response.Success > 0) {
                    var voidRun = $scope.runList.find(function (r) { return r.isVoidRun === true; });

                    angular.forEach(jobIds, function (jobId) {
                        var job = $filter('filter')($scope.runJobsAll, function (j) { return j.BulkJobID === jobId; })[0];
                        if (job) {
                            job.Void = false;
                            job.JobStatus = 0;
                            job.inBuilder = 0;

                            // Remove from void run
                            if (voidRun) {
                                var idx = voidRun.jobs.indexOf(job);
                                if (idx >= 0) {
                                    voidRun.jobs.splice(idx, 1);
                                }
                            }

                            // Remove from runBuilder display
                            var rbIdx = $scope.runBuilder.indexOf(job);
                            if (rbIdx >= 0) {
                                $scope.runBuilder.splice(rbIdx, 1);
                            }
                        }
                    });

                    // Backend already cleaned up the run if empty.
                    // Remove void run from frontend list if empty.
                    if (voidRun && voidRun.jobs.length === 0) {
                        var removeIdx = $scope.runList.indexOf(voidRun);
                        if (removeIdx >= 0) {
                            $scope.runList.splice(removeIdx, 1);
                        }
                        // Switch to first run if we were viewing the void run
                        if ($scope.isVoidRunActive && $scope.runList.length > 0) {
                            $scope.showRun($scope.runList[0]);
                        }
                    }
                    $scope.updateRun();
                } else {
                    var msg = (data.response && data.response.Message) ? data.response.Message : 'Un-void operation failed';
                    alert(msg);
                }
            });
        };

        // =============================================
        // END VOID JOBS FUNCTIONALITY
        // =============================================

        $scope.addToRunBuilder = function (job) {

            var list = $(".activeTable").attr("id");

            $scope.runBuilder.push(angular.copy(job));

            var index = $scope[list].indexOf(job);
            $scope[list][index].inBuilder = 1;

            var runJobsAllindex = $scope.runJobsAll.indexOf(job);
            $scope.runJobsAll[runJobsAllindex].inBuilder = 1;

        };

        $scope.addGroupToRunBuilder = function (jobs) {

            var list = $(".activeTable").attr("id");

            angular.forEach(jobs, function (job, key) {

                if (job.inBuilder != 1) {

                    $scope.runBuilder.push(angular.copy(job));

                    var index = jobs.indexOf(job);
                    jobs[index].inBuilder = 1;
                    //group.jobs.splice(index, 1);

                    var indexInAllJobs = $scope.runJobsAll.indexOf(job);
                    $scope.runJobsAll[indexInAllJobs].inBuilder = 1;
                    //$scope.runJobsAll.splice(index, 1);
                }

            });

        };

        ////////////////////////
        // RUN LIST 
        ///////////////////////


        $scope.localStorage = function () {
            //check cookies etc

            // If localStorage is null or Empty
            //if (!localStorage.getItem('runList') || localStorage.getItem('runList') == "[]" ) {
            //if (!$scope.bulkRuns) {
            // Crate a new RunList


            $scope.runList = [];
            $scope.newRun();

            if ($scope.bulkRuns) {
                //$scope.runList = $scope.bulkRuns;
                // For each courier jobs runList
                angular.forEach($scope.bulkRuns, function (list, key) {
                    $scope.runList.push(list);
                });
            }

            // Create a new run object 

            // Load all run jobs into the run builder order list
            $scope.runBuilder = $scope.runList[0].jobs;
            $scope.activateRunDrop();
            $scope.activateRunListDrop();

            // Create a new courier jobs group
            if ($scope.runNameJobsGroups.length > 0) {
                // Conbine the empty run with the courier groups run
                $scope.runList.push.apply($scope.runList, $scope.runNameJobsGroups);
                // For each courier jobs runList
                angular.forEach($scope.runList, function (list, key) {
                    var courier = $filter('filter')($scope.couriers, c => c.courierID == list.name)[0];
                    // Assign courier to the assigned run
                    if (courier) {
                        $filter('filter')($scope.runList, r => r.name == courier.courierID)[0].courier = courier;
                    }
                });
            }

            // Disable this because sometimes the postcode ID is the same as our courier ID and this will cause run get assigned to the wrong courier
            //// Create a new courier jobs group
            //if ($scope.courierJobsGroup.length > 0) {
            //             // Conbine the empty run with the courier groups run
            //    $scope.runList.push.apply($scope.runList, $scope.courierJobsGroup);
            //    // For each courier jobs runList
            //    angular.forEach($scope.runList, function (list,key) {
            //        var courier = $filter('filter')($scope.couriers, c => c.courierID == list.name)[0];
            //                 // Assign courier to the assigned run
            //        if (courier) {
            //            $filter('filter')($scope.runList, r=> r.name == courier.courierID)[0].courier = courier;
            //        }
            //    });
            //}

            // Active run map
            setTimeout(function () {
                $("#runList").find(".clickable-row").first().click().addClass("active");

                $scope.activateRunDrop();
                $scope.activateRunListDrop();
            }, 1000);

            // Removing run list jobs from the all jobs group
            angular.forEach($scope.runList, function (list, key) {
                angular.forEach(list.jobs, function (job, key) {
                    setTimeout(function () {
                        $filter('filter')($scope.runJobsAll, j => j.JobNumber === job.JobNumber)[0].inBuilder = 1;
                    }, 0);
                });
            });

            // Ensure the Void Jobs run exists and collect voided jobs into it
            $scope.ensureVoidJobsRun();


            //} else {

            //	//$scope.runList = JSON.parse(localStorage.getItem('runList'));
            //             //$scope.runList = $scope.bulkRuns;

            //     $scope.runList = [];
            //     // Create a new run object 
            //     $scope.newRun();
            //     // For each courier jobs runList
            //     angular.forEach($scope.bulkRuns, function(list, key) {
            //         $scope.runList.push(list);
            //     });

            //	setTimeout(function() { 
            //		$("#runList").find(".clickable-row").first().click().addClass("active");				
            //		$scope.activateRunDrop();
            //		$scope.activateRunListDrop();
            //	}, 1000);

            //	angular.forEach($scope.runList, function(list, key) {
            //		angular.forEach(list.jobs, function(job,key) {
            //			setTimeout(function() {
            //			    $filter('filter')($scope.runJobsAll, j=> j.JobNumber == job.JobNumber)[0].inBuilder = 1;
            //			},0);
            //		});
            //	});
            //}

            //$scope.$watch('runList', function (newValue, oldValue, scope) {

            //	localStorage.setItem('runList',JSON.stringify(newValue));

            //}, true);
        };

        //$scope.getPotentialCouriers();

        $scope.sendTo = function (path) {
            $("#box-runList").find(".loading").show();

            // Check any unlocked runs in the list (exclude Void Jobs run)
            if ($scope.runList.filter(runs => runs.jobs.length > 0 && (runs.locked == 0 || runs.ID == null) && !runs.isVoidRun).length > 0) {
                alert("Unlocked runs found! Please make sure all runs are locked and try it again!");
                $("#box-runList").find(".loading").fadeOut();
                return false;
            }

            // Check client filter is on or not
            if ($scope.pickDateService.clients.length > 0) {
                var confirmSendJobWithClientFilterOn = confirm("Warning: The client filter is on, are you sure you want to insert these runs?");
                if (confirmSendJobWithClientFilterOn === false) {
                    $("#box-runList").find(".loading").fadeOut();
                    return false;
                }
            }

            var i = 0;
            //// Check whether all jobs get despatched to a courier
            //angular.forEach($scope.runList, function (run, key) {
            //    if (run.jobs.length > 0 && !run.courier.courier) {
            //        i++;
            //    }
            //});
            //i = $scope.runList.filter(runs => runs.jobs.length > 0 && !runs.courier.courier).length;



            var totalJobs = 0;
            // Continue when all jobs are despatched to courier
            if (i == 0) {
                angular.forEach($scope.groupedJobs,
                    function (group, key) {
                        angular.forEach(group.jobs,
                            function (job, jkey) {
                                //Get total jobs varaiable
                                totalJobs++;
                                if (!job.inBuilder) {
                                    job.inBuilder = 0;
                                }
                                if (job.inBuilder == 0) {
                                    i++;
                                }
                            });
                    });
            }

            // copy real job array from runlist (exclude Void Jobs run)
            var buildedRunList = $scope.runList.filter(r => r.jobs.length > 0 && !r.isVoidRun);
            // Replace Jobs to just what we need
            angular.forEach(buildedRunList, function (run, key) {
                run.jobs = run.jobs.map(x => {
                    return {
                        BulkJobID: x.BulkJobID,
                        BuilderIndex: x.BuilderIndex
                    };
                });
            });

            // Send to live when all jobs are routed 
            if (i == 0) {
                //console.log("SEND IT!");
                uRunData.doAPI(path, JSON.stringify(buildedRunList)).then(function (data) {
                    //alert("Job Inserted " + response);
                    //var totalJobs = $scope.runList[0].jobs.length;
                    var alertHtml = "";
                    var successTotal = 0;
                    for (var j = 0; j < data.response.length; j++) {
                        if (data.response[j].Result == "Success") {
                            successTotal++;
                        } else {
                            alertHtml += data.response[j].Message + "\n";
                        }
                    }

                    $("#box-runList").find(".loading").fadeOut();

                    // Clear Storage and reset all job list
                    if (totalJobs == successTotal) {
                        alert(successTotal + " Job Inserted Successfully");
                        $scope.getData(1);
                    } else {

                        var failedTotal = totalJobs - successTotal;
                        var message = successTotal + " Job Inserted Successfully, while " + failedTotal + " Failed \n\n";
                        var alterMessage = message + alertHtml;
                        alert(alterMessage);
                    }

                    $(".gpsForm").hide(0);

                });
            } else {
                alert("You can not send until all jobs are allocated");
                $("#box-runList").find(".loading").fadeOut();
            }
        };

        // Only send selected runs into live
        $scope.sendSelectedJobsToLive = function () {
            $("#box-runList").find(".loading").show();

            // Check client filter is on or not
            var confirmSendSelectedJobsOnly = confirm("Warning: Are you sure you want to insert selected runs only?");
            if (confirmSendSelectedJobsOnly === false) {
                $("#box-runList").find(".loading").fadeOut();
                return false;
            }

            // Check any unlocked runs in the list (exclude Void Jobs run)
            if ($scope.runList.filter(runs => runs.jobs.length > 0 && (runs.locked == 0 || runs.ID == null) && !runs.isVoidRun).length > 0) {
                alert("Unlocked runs found! Please make sure all runs are locked and try it again!");
                $("#box-runList").find(".loading").fadeOut();
                return false;
            }

            //var i = 0;
            //// Check whether all jobs get despatched to a courier
            //angular.forEach($scope.runList, function (run, key) {
            //    if (run.jobs.length > 0 && !run.courier.courier) {
            //        i++;
            //    }
            //});
            //i = $scope.runList.filter(runs => runs.jobs.length > 0 && !runs.courier.courier).length;

            var totalJobs = 0;
            //// Continue when all jobs are despatched to courier
            //if (i == 0) {
            //    angular.forEach($scope.groupedJobs,
            //        function (group, key) {
            //            angular.forEach(group.jobs,
            //                function (job, jkey) {
            //                    //Get total jobs varaiable
            //                    totalJobs++;
            //                    if (!job.inBuilder) {
            //                        job.inBuilder = 0;
            //                    }
            //                    if (job.inBuilder == 0) {
            //                        i++;
            //                    }
            //                });
            //        });
            //}

            var selectedBuildedRunList = [];
            $("#box-runList .active").each(function () {
                let currentRun = $(this).scope().run;
                if (currentRun.jobs.length > 0 && currentRun.locked == 1 && !currentRun.isVoidRun) {
                    selectedBuildedRunList.push(currentRun);
                    totalJobs += currentRun.jobs.length;
                };
            });

            // Replace Jobs to just what we need
            angular.forEach(selectedBuildedRunList, function (run, key) {
                run.jobs = run.jobs.map(x => {
                    return {
                        BulkJobID: x.BulkJobID,
                        BuilderIndex: x.BuilderIndex
                    };
                });
            });

            // Send to live when all jobs are routed 
            //if (i == 0) {
            //console.log("SEND IT!");
            uRunData.doAPI("/Job/InsertRunJobs", JSON.stringify(selectedBuildedRunList)).then(function (data) {
                //alert("Job Inserted " + response);
                //var totalJobs = $scope.runList[0].jobs.length;
                var alertHtml = "";
                var successTotal = 0;
                for (var j = 0; j < data.response.length; j++) {
                    if (data.response[j].Result == "Success") {
                        successTotal++;
                    } else {
                        alertHtml += data.response[j].Message + "\n";
                    }
                }

                $("#box-runList").find(".loading").fadeOut();

                // Clear Storage and reset all job list
                if (totalJobs == successTotal) {
                    alert(successTotal + " Job Inserted Successfully");
                    $scope.getData(1);
                } else {

                    var failedTotal = totalJobs - successTotal;
                    var message = successTotal + " Job Inserted Successfully, while " + failedTotal + " Failed \n\n";
                    var alterMessage = message + alertHtml;
                    alert(alterMessage);
                }

                $(".gpsForm").hide(0);

            });
            //} else {
            //    alert("You can not send until all jobs are allocated");
            //    $("#box-runList").find(".loading").fadeOut();
            //}
        };

        $scope.runListMenu = [
            // Edit Name
            {
                text: 'Edit Name',
                click: function ($itemScope, $event, modelValue, text, $li) {

                    $scope.gather.form = {
                        id: "editName",
                        title: "Edit Name",
                        fields: [
                            {
                                "name": "editName",
                                "label": "Edit Name",
                                "value": $itemScope.run.name
                            }
                        ],
                        onSubmit: function () {
                            var newName = $("#editName").find("input").val();
                            $itemScope.run.name = newName;

                            // If the run is locked and has id, then update the run
                            if ($itemScope.run.locked && $itemScope.run.ID) $scope.updateBulkRun($itemScope.run);

                        },
                        submitValue: "Save"
                    };

                    $scope.gather.showForm();

                },
                //// Enable for unlocked runs only
                //enabled: function ($itemScope, $event, modelValue, text, $li) {
                //    // enabled = true, disabled = false
                //    if ($itemScope.run.locked) return false;
                //    return true;
                //}
            },
            {
                text: 'Edit Route Date',
                click: function ($itemScope, $event, modelValue, text, $li) {
                    // Get the current date from the first job in the run, or use today's date as fallback
                    var currentDateString = moment().format("YYYY-MM-DD");
                    var currentDateObj = new Date();

                    if ($itemScope.run.jobs && $itemScope.run.jobs.length > 0) {
                        var firstJobDate = $itemScope.run.jobs[0].DeliveryDate;
                        if (firstJobDate) {
                            // Parse the DD/MM/YYYY format and convert to Date object
                            var parsedMoment = moment(firstJobDate, 'DD/MM/YYYY');
                            if (parsedMoment.isValid()) {
                                currentDateString = parsedMoment.format("YYYY-MM-DD");
                                currentDateObj = parsedMoment.toDate();
                            }
                        }
                    }

                    $scope.gather.form = {
                        id: "editRouteDate",
                        title: "Edit Route Date",
                        fields: [
                            {
                                "name": "routeDate",
                                "label": "Route Date",
                                "value": currentDateObj, // Always use Date object
                                "type": "date",
                                "runId": $itemScope.run.ID,
                                "jobCount": $itemScope.run.jobs ? $itemScope.run.jobs.length : 0
                            }
                        ],
                        onSubmit: function () {
                            var newDateValue = $scope.gather.form.fields[0].value;
                            var runId = $scope.gather.form.fields[0].runId;
                            var jobCount = $scope.gather.form.fields[0].jobCount;

                            if (jobCount === 0) {
                                alert("No jobs in this run to update.");
                                return;
                            }

                            // Ensure we have a valid Date object
                            var dateForProcessing;
                            if (newDateValue instanceof Date) {
                                dateForProcessing = newDateValue;
                            } else if (typeof newDateValue === 'string') {
                                dateForProcessing = new Date(newDateValue);
                            } else {
                                alert("Invalid date selected. Please try again.");
                                return;
                            }

                            // Validate the date
                            if (isNaN(dateForProcessing.getTime())) {
                                alert("Invalid date selected. Please try again.");
                                return;
                            }

                            // Convert to API format (YYYY-MM-DD)
                            var dateForApi = moment(dateForProcessing).format("YYYY-MM-DD");

                            // Confirm the bulk update
                            var confirmMessage = "Are you sure you want to update the delivery date for all " +
                                jobCount + " jobs in run '" + $itemScope.run.name + "' to " +
                                moment(dateForProcessing).format("DD/MM/YYYY") + "?";

                            if (confirm(confirmMessage)) {
                                $scope.bulkUpdateRouteDate($itemScope.run, dateForApi);
                            }
                        },
                        submitValue: "Update Date"
                    };
                    $scope.gather.showForm();
                },
                // Only show for runs that have jobs
                enabled: function ($itemScope, $event, modelValue, text, $li) {
                    return $itemScope.run.jobs && $itemScope.run.jobs.length > 0;
                }
            },
            // Merge selected run to another run
            {
                text: 'Merge selected run to another run',
                click: function ($itemScope, $event, modelValue, text, $li) {
                    $scope.gather.form = {
                        id: "mergeRun",
                        title: "Merge Run",
                        fields: [
                            {
                                "name": "mergeRun",
                                "label": "Run Name Merge to",
                                "value": $itemScope.run.name
                            }
                        ],
                        onSubmit: function () {
                            // Get run name merge to
                            setTimeout(function () {
                                var runNameMergeTo = $scope.gather.form.fields[0].value;
                                //var runNameMergeTo = $("#mergeRun").find("input").val();

                                // reverse when merge with itself
                                if (runNameMergeTo.toLowerCase() === $itemScope.run.name.toLowerCase()) {
                                    alert("Error: " + runNameMergeTo + " can not merge with itself, please choose a different run to merge with");
                                    return false;
                                }

                                // Get Run merge to
                                //var runMergeTo = $scope.runList.find(x => x.name.toLowerCase() == runNameMergeTo.toLowerCase());
                                if ($filter('filter')($scope.runList, function (i) { return i.name.toLowerCase() === runNameMergeTo.toLowerCase() })[0]) {

                                    // Found the destination run is in lock mode
                                    if ($filter('filter')($scope.runList, function (i) { return i.name.toLowerCase() === runNameMergeTo.toLowerCase() && i.locked == 1 })[0]) {
                                        alert("Error: " + runNameMergeTo + " has been locked, please un-lock the run before the merging");
                                        return false;
                                    }

                                    // Merge current run jobs into the runMergeTo
                                    var runMergeTo = $filter('filter')($scope.runList,
                                        function (i) {
                                            return i.name.toLowerCase() === runNameMergeTo.toLowerCase();
                                        })[0];
                                    runMergeTo.jobs = runMergeTo.jobs.concat($itemScope.run.jobs);

                                    //// Remove current jobs from the run
                                    //angular.forEach($itemScope.run.jobs, function (job, key) {

                                    //    runMergeTo.jobs.push(job);

                                    //    var index = $scope.runBuilder.indexOf(job);
                                    //    $scope.runBuilder.splice(index, 1);
                                    //});

                                    var index = $scope.runList.indexOf($itemScope.run);
                                    $scope.runList.splice(index, 1);


                                    if ($filter('filter')($scope.runList, { 'isActive': 1 })[0]) {
                                        $filter('filter')($scope.runList, { 'isActive': 1 })[0].isActive = 0;
                                    }
                                    runMergeTo.isActive = 1;

                                    $("#runList").find(".active").removeClass("active");
                                    $("#runList").find("[data-runname='" + runMergeTo.name + "']").addClass("active"); //.trigger('click');

                                    if ($scope.runList.length > 0) {
                                        $scope.runBuilder = runMergeTo.jobs;
                                    } else {
                                        $scope.runList = [];
                                        $scope.runList[0] = { "jobs": [] };
                                        $scope.runBuilder = $scope.runList[0].jobs;
                                        $scope.activateRunDrop();
                                        $scope.activateRunListDrop();
                                    }

                                    $scope.updateRun();
                                    $scope.$apply();
                                } else {
                                    alert("Error: " + runNameMergeTo + " can not be found!");
                                }
                                return false;
                            }, 0);
                        },
                        submitValue: "Save"
                    };

                    $scope.gather.showForm();
                }

            },
            // Routing run
            {
                text: 'Route and Lock Run',
                click: function ($itemScope, $event, modelValue, text, $li) {
                    //// Route and lock run
                    //$scope.showRun($itemScope.run, 1); // 1 = Route the run
                    //setTimeout(function () { $scope.activateRunDrop(); $scope.activateRunListDrop(); }, 500);

                    //// Route and lock run
                    $("#box-map").find(".loading").show();
                    $("#box-runList").find(".loading").show();
                    $("#box-runBuilder").find(".loading").show();
                    var runIndex = $scope.runList.indexOf($itemScope.run);
                    $scope.routeRun(runIndex);
                    //$scope.showRun($itemScope.run, 1); // 1 = Route the run
                    //setTimeout(function () { $scope.activateRunDrop(); $scope.activateRunListDrop(); }, 500);
                }
            },
            // Toggle Run Lock
            {
                text: 'Toggle Run Lock',
                click: function ($itemScope, $event, modelValue, text, $li) {
                    //if ($itemScope.run.locked != 1) {
                    //    // Check all jobs get RunOrders before lock the run
                    //    var unRoutJobs = $itemScope.run.jobs.filter(j => j.BuilderIndex == null || j.BuilderIndex == "undefined");
                    //    if (unRoutJobs.length > 0) {
                    //        if (!confirm('Are you sure you want to lock this un-route run into the database?')) {
                    //            return false;
                    //        }
                    //        //alert("Please route the run before we can lock it.");
                    //        //return false;
                    //    }

                    //    // Insert/Update run detail into database
                    //    //  Store ID back into run  
                    //    uRunData.doAPI("Job/InsertOrUpdateRun", JSON.stringify($itemScope.run)).then(function (data) {
                    //        if (data.response.Result == "Success") {
                    //            $itemScope.run.ID = parseInt(data.response.Message);
                    //        } else {
                    //            if (data.response.Message) {
                    //                alert(data.response.Result + ": " +  data.response.Message);
                    //            } else {
                    //                alert(data.response);  
                    //            }

                    //            return false;
                    //        }

                    //        $itemScope.run.locked = 1;
                    //        $scope.showRun($itemScope.run);
                    //    });
                    //} else {
                    //    //  Store ID back into run  
                    //    uRunData.doAPI("Job/DeleteRun", JSON.stringify($itemScope.run)).then(function (data) {
                    //        if (data.response == "Success") {
                    //            $itemScope.run.ID = null;
                    //        } else {
                    //            alert(data.response);
                    //            return false;
                    //        }
                    //    });

                    //    $itemScope.run.locked = 0;
                    //    $scope.showRun($itemScope.run);

                    //    setTimeout(function () { $scope.activateRunDrop(); $scope.activateRunListDrop(); }, 0);
                    //}
                    $("#box-map").find(".loading").show();
                    $("#box-runList").find(".loading").show();

                    $scope.toggleRunLock($itemScope.run);
                }
            },
            // Remove
            {
                text: 'Remove',
                click: function ($itemScope, $event, modelValue, text, $li) {
                    setTimeout(function () {

                        //console.log($itemScope);
                        angular.forEach($itemScope.run.jobs, function (job, key) {
                            $scope.deleteFromRun(job);
                        });

                        var index = $scope.runList.indexOf($itemScope.run);
                        $scope.runList.splice(index, 1);

                        if ($scope.runList.length > 0) {
                            $scope.runBuilder = $scope.runList[0].jobs;
                        } else {
                            $scope.runList = [];
                            $scope.runList[0] = { "jobs": [] };
                            $scope.runBuilder = $scope.runList[0].jobs;
                            $scope.activateRunDrop();
                            $scope.activateRunListDrop();
                        }

                        // select Run1 as the default select run after delete 
                        $scope.runList[0].isActive = 1;

                        $scope.$apply();
                    }, 0);
                },
                // Enable for unlocked runs only
                enabled: function ($itemScope, $event, modelValue, text, $li) {
                    // enabled = true, disabled = false
                    if ($itemScope.run.locked) return false;
                    return true;
                }
            },
            {
                text: 'Send Selected Runs To Live',
                click: function ($itemScope, $event, modelValue, text, $li) {
                    $scope.sendSelectedJobsToLive();
                },
                // Enable for locked runs only
                enabled: function ($itemScope, $event, modelValue, text, $li) {
                    // enabled = true, disabled = false
                    if (!$itemScope.run.locked) return false;
                    return true;
                }
            }
        ];

        $scope.parseJobDate = function (dateString) {
            if (!dateString) return new Date();

            // Try parsing DD/MM/YYYY format first
            var parsed = moment(dateString, 'DD/MM/YYYY', true);
            if (parsed.isValid()) {
                return parsed.toDate();
            }

            // Try parsing YYYY-MM-DD format
            parsed = moment(dateString, 'YYYY-MM-DD', true);
            if (parsed.isValid()) {
                return parsed.toDate();
            }

            // Fallback to JavaScript Date parsing
            var fallback = new Date(dateString);
            if (!isNaN(fallback.getTime())) {
                return fallback;
            }

            // If all else fails, return today's date
            return new Date();
        };

        $scope.bulkUpdateRouteDate = function (run, newDate) {
            if (!run.jobs || run.jobs.length === 0) {
                alert("No jobs in this run to update.");
                return;
            }

            // Show loading indicator
            $("#box-runList").find(".loading").show();

            // Prepare the request data
            var jobIds = run.jobs.map(function (job) {
                return job.BulkJobID;
            });

            var requestData = {
                JobIds: jobIds,
                NewDate: newDate,
                RunName: run.name
            };

            // Call the bulk update API
            uRunData.doAPI("Job/BulkUpdateRouteDate", JSON.stringify(requestData)).then(function (data) {
                $("#box-runList").find(".loading").fadeOut();

                if (data && data.response) {
                    var result = data.response;
                    var message = result.Message || "Date update completed!";

                    // Show detailed results if there were any failures
                    if (result.Failed > 0) {
                        message += "\n\nFailed jobs:";
                        if (result.Details) {
                            var failedJobs = result.Details.filter(function (d) { return d.Result === "Failed"; });
                            failedJobs.forEach(function (failure) {
                                message += "\n- " + failure.Message;
                            });
                        }
                    }

                    alert(message);

                    // Always refresh all data after the update (successful or not)
                    console.log("Performing complete data refresh after bulk date update");
                    $scope.getData(1); // Pass 1 to clear storage and completely refresh

                } else {
                    console.error("Unexpected response format:", data);
                    alert("Unexpected response from server. Please try again.");
                }
            }).catch(function (error) {
                $("#box-runList").find(".loading").fadeOut();
                console.error("Error during bulk date update:", error);
                alert("An error occurred while updating dates. Please check the console for details.");
            });
        };

        // Lock run
        $scope.toggleRunLock = function (run, updateRunOnly) {
            // Update if the run is locked
            if (run.locked != 1 || updateRunOnly) {
                ////// Check all jobs get RunOrders before lock the run
                ////var unRoutJobs = run.jobs.filter(j => j.BuilderIndex == null || j.BuilderIndex == "undefined");
                ////if (unRoutJobs.length > 0) {
                ////    if (!confirm('Are you sure you want to lock this un-route run into the database?')) {
                ////        return false;
                ////    }
                ////    //alert("Please route the run before we can lock it.");
                ////    //return false;
                ////}

                //// Insert/Update run detail into database
                ////  Store ID back into run  
                //uRunData.doAPI("Job/InsertOrUpdateRun", JSON.stringify(run)).then(function (data) {
                //    if (data.response.Result == "Success") {
                //        run.ID = parseInt(data.response.Message);
                //    } else {
                //        if (data.response.Message) {
                //            alert(data.response.Result + ": " + data.response.Message);
                //        } else {
                //            alert(data.response);
                //        }

                //        return false;
                //    }

                //    run.locked = 1;
                //    $scope.showRun(run);
                //});
                $scope.InsertOrUpdateRun(run);
            } else {
                $scope.DeleteRun(run);
            }
        };

        $scope.InsertOrUpdateRun = function (run) {
            // Prepare request data
            let runRequestData = {
                ID: run.ID,
                Name: run.name,
                Mins: run.mins,
                Kms: run.kms,
                Status: run.status,
                Revenue: run.revenue,
                Payout: run.payout,
                CourierPercent: run.courierPercent,
                Courier: run.courier,
                Jobs: run.jobs.map(j => ({ BulkJobID: j.BulkJobID, JobNumber: j.JobNumber, BuilderIndex: j.BuilderIndex })),
                GoogleRouteResponse: null
            }

            //uRunData.doAPI("Job/InsertOrUpdateRun", JSON.stringify(run)).then(function (data) {
            uRunData.doAPI("Job/InsertOrUpdateRun", JSON.stringify(runRequestData)).then(function (data) {
                $("#box-map").find(".loading").fadeOut();
                $("#box-runList").find(".loading").fadeOut();
                $("#box-runBuilder").find(".loading").fadeOut();

                if (data.response.Result == "Success") {
                    run.ID = parseInt(data.response.Message);
                } else {
                    if (data.response.Message) {
                        alert(data.response.Result + ": " + data.response.Message);
                    } else {
                        alert(data.response);
                    }

                    return false;
                }

                run.locked = 1;
                $scope.showRun(run);

                setTimeout(function () { $scope.activateRunDrop(); $scope.activateRunListDrop(); }, 0);
            });
        };

        $scope.updateBulkRun = function (run) {
            uRunData.doAPI("Job/UpdateRun", JSON.stringify(run)).then(function (data) {
                if (data.response.Result !== "Success") {
                    if (data.response.Message) {
                        alert(data.response.Result + ": " + data.response.Message);
                    } else {
                        alert(data.response);
                    }
                }

                $scope.showRun(run);
                setTimeout(function () { $scope.activateRunDrop(); $scope.activateRunListDrop(); }, 0);
            });
        };

        $scope.DeleteRun = function (run) {
            //  Store ID back into run  
            //uRunData.doAPI("Job/DeleteRun", JSON.stringify(run)).then(function (data) {
            uRunData.doAPI("Job/DeleteRun", run.ID).then(function (data) {
                $("#box-map").find(".loading").fadeOut();
                $("#box-runList").find(".loading").fadeOut();

                if (data.response == "Success") {
                    run.ID = null;
                    run.locked = 0;
                    $scope.showRun(run);
                } else {
                    alert(data.response);
                    return false;
                }
            });

            setTimeout(function () { $scope.activateRunDrop(); $scope.activateRunListDrop(); }, 0);
        };

        $scope.activateRunListDrop = function () {
            setTimeout(function () {
                $(document).ready(function (event) {
                    $(".droppable-item").droppable({
                        classes: {
                            "ui-droppable-hover": "active"
                        },
                        drop: function (event, ui) {
                            //$(this).addClass("active");

                            var run = $(this).scope().run;

                            $(".activeTable .active").each(function () {

                                if ($(this).attr("data-isGroup") == 1 && run.locked != 1) {

                                    var jobs = $(this).scope().grouped.jobs;

                                    angular.forEach(jobs, function (job, key) {
                                        if (job.inBuilder != 1) {
                                            job.inBuilder = 1;
                                            run.jobs.push(job);
                                        }
                                    });

                                } else if ($(this).attr("data-isCourier") == 1) {
                                    //// Adding preassign run for couriers
                                    //var message = "Do you want to pre-assign this run " + run.name + " to the courier " + $(this).scope().courier.courier + "?";
                                    //var confirmPreassignJobStatus = confirm(message);
                                    //if (confirmPreassignJobStatus === true) {
                                    //    run.status = 18; // Preassigned job status;
                                    //} else {
                                    //    run.status = 0;
                                    //}

                                    var message = "Do you want to pre-assign this run " + run.name + " to the courier " + $(this).scope().courier.courier + "?";

                                    $ngConfirm({
                                        title: 'Confirm!',
                                        content: message,
                                        scope: $(this).scope(),
                                        //backgroundDismiss: true,
                                        buttons: {
                                            sayBoo: {
                                                text: 'Yes',
                                                btnClass: 'btn-green',
                                                action: function (scope, button) {
                                                    run.status = 18; // Preassigned job status;
                                                    //return false; // prevent close;
                                                    run.courier = scope.courier;
                                                    $scope.$apply();

                                                    // Update this run
                                                    $scope.InsertOrUpdateRun(run);
                                                }
                                            },
                                            somethingElse: {
                                                text: 'No',
                                                btnClass: 'btn-orange',
                                                action: function (scope, button) {
                                                    run.status = 0; // Preassigned job status;
                                                    run.courier = scope.courier;
                                                    $scope.$apply();

                                                    // Update this run
                                                    $scope.InsertOrUpdateRun(run);
                                                }
                                            },
                                            close: function (scope, button) {
                                                // closes the modal
                                            }
                                        }
                                    });

                                    //run.courier = $(this).scope().courier;
                                    //$scope.$apply();

                                    //// Update this run
                                    //$scope.InsertOrUpdateRun(run);

                                } else if (run.locked != 1) {

                                    var job = $(this).scope().job;
                                    job.inBuilder = 1;
                                    run.jobs.push(job);

                                    if ($(this).attr("data-inbuilder") == 1) {

                                        var index = $scope.runBuilder.indexOf(job);
                                        $scope.runBuilder.splice(index, 1);
                                    }

                                    $scope.$apply();
                                }

                            });

                            $scope.$apply();
                            $scope.updateRun();

                        }
                    });
                });
            }, 0);
        };

        //setTimeout(function () {
        //    $scope.activateRunListDrop();
        //}, 1000);

        $scope.runAreas = function (run) {
            if (run.jobs.length > 0) {
                var names = [];
                angular.forEach(run.jobs, function (job, key) {
                    if (!names[job.ToPostCode]) {
                        names.push(job.ToPostCode);
                    }
                });

                var uniq = names.reduce(function (a, b) {
                    if (a.indexOf(b) < 0) a.push(b);
                    return a;
                }, []);

                return (uniq.join(", "));
            } else {
                return ("No Jobs");
            }
        };

        $scope.newRun = function (jobs) {
            var newName = "Run " + ($scope.runList.length + 1);
            $scope.runList.unshift({
                "name": newName,
                "jobs": [],
                "mins": 0,
                "kms": 0
            });

            setTimeout(function () {
                $("#runList").find(".active").removeClass("active");
                $("#runList").find(".clickable-row").first().click().addClass("active");
                if (jobs) {
                    $scope.addGroupToRunBuilder(jobs);
                }
                $scope.$apply();
                $scope.updateRun();
                $scope.activateRunListDrop();

            }, 0);
        };

        $scope.runBuilderTotals = function () {
            //$scope.calc = {};
            if ($scope.runBuilder) {
                if ($scope.runBuilder.length > 0 && $filter('filter')($scope.runList, { 'isActive': 1 })) {
                    if ($filter('filter')($scope.runList, { 'isActive': 1 }).length > 0) {

                        //var hourlyRate = 25;
                        //var expPerKm = 0.5;

                        //$scope.calc.totalMins = $filter('filter')($scope.runList, { 'isActive': 1 })[0].mins;
                        //$scope.calc.totalKms = $filter('filter')($scope.runList, { 'isActive': 1 })[0].kms;

                        //$scope.calc.timeAsHourPercent = Math.round($scope.calc.totalMins / 60 * 100) / 100;
                        //$scope.calc.totalDrops = $filter('filter')($scope.runList, { 'isActive': 1 })[0].jobs.length;
                        //$scope.calc.petrolExpense = $scope.calc.totalDrops * expPerKm;

                        //$scope.calc.totalPayout = Math.round(hourlyRate * $scope.calc.timeAsHourPercent * 100) / 100;

                        ////Revenue 
                        //$scope.calc.revenue = 0;
                        //angular.forEach($scope.runBuilder, function (value, key) {
                        //    $scope.calc.revenue += parseInt(value.Amount);
                        //});


                        //$scope.calc.courierPercent = (Math.round(($scope.calc.totalPayout / $scope.calc.revenue * 100) * 100) / 100);

                        //if ($scope.calc.courierPercent > 75) {
                        //    $scope.calc.courierPercentColour = "red";
                        //} else if ($scope.calc.courierPercent > 65) {
                        //    $scope.calc.courierPercentColour = "orange";
                        //} else {
                        //    $scope.calc.courierPercentColour = "green";
                        //}

                        //$scope.calc.courierPercent = $scope.calc.courierPercent + "%";
                        var run = $filter('filter')($scope.runList, { 'isActive': 1 })[0];

                        $scope.calculateRunDetails(run.jobs, run.mins, run.kms);
                        $filter('filter')($scope.runList, { 'isActive': 1 })[0].courierPercent = angular.copy($scope.calc.courierPercent);
                    }

                }
            } else {
                return " ";
            }
        };

        $scope.runListCombined = function (cancelled) {
            //$scope.allJobs = [];
            //angular.forEach($scope.runList, function (run, key) {
            //    angular.forEach(run.jobs, function (job, jkey) {
            //        if (cancelled === true) {
            //            if (job.Status === "Cancelled") {
            //                $scope.allJobs.push(job);
            //            }
            //        } else {
            //            $scope.allJobs.push(job);
            //        }

            //    });
            //});
            return $scope.runJobsAll;
        };

        // Route and update run detail via HereMap
        $scope.updateRunDetailsFromRun = function (run) {
            // User the first jobs start point as start and end location, it's Urgent courier in this case
            var start = encodeURIComponent(run.jobs[0].fromLat + "," + run.jobs[0].fromLng);
            var end = start;
            var destinations = run.jobs.map(function (item) { return encodeURIComponent(item.JobNumber + ";" + item.toLat + "," + item.toLng); });

            // Prepare parameters for HereMap API
            var requestData =
                [
                    "&mode=fastest;car;traffic:disabled;",
                    "&start=", start
                    //"&end=", end
                ];

            for (var i = 0, k = 0; i < destinations.length; i++) {
                if (destinations[i] != null && destinations[i].trim().length > 0) {
                    requestData.push("&destination" + (k + 1) + "=", destinations[i]);
                    k++;
                }
            }

            // String requestDataString
            var requestDataString = requestData.join("");

            // Call HereMap for each runs 
            uRunData.getHereMapSequence(requestDataString).then(function (data) {
                // Display error message if there is any
                if (data.errors != null && data.errors.length > 0) {
                    alert(data.errors[0]);
                    $scope.hideAllLoading();
                    return false;
                }
                if (data.results != null && data.results.length > 0) {

                    var r = data.results[0];

                    //// remove and start and end point routes
                    r.waypoints.splice(0, 1);
                    //r.waypoints.splice(r.waypoints.length - 1, 1);

                    //// remove distance and time from the last job to the base
                    //r.interconnections.splice(r.interconnections.length - 1, 1);

                    // Get the run from the runsToInsertList
                    var RunToInsertIndex = -1;
                    for (var i = 0; i < $scope.runsToInsertList.length; i++) {
                        if ($scope.runsToInsertList[i].jobs.findIndex(x => x.JobNumber === r.waypoints[0].id) >= 0) {
                            RunToInsertIndex = i;
                            break;
                        }
                    }

                    // Don't do anything if doesn't find any jobs
                    if (RunToInsertIndex == -1) {
                        return;
                    }

                    var runOrder = 0;
                    //Insert build index for jobs
                    for (var j = 0; j < r.waypoints.length; j++) {
                        var referenceJobNumber = r.waypoints[j].id;
                        var multiboxParentJobBuilderIndex = 0;
                        // Multiboxes jobs
                        if (referenceJobNumber.substr(referenceJobNumber.length - 2, 1) == "-") {
                            // Keep the same pickup order for multiboxes jobs
                            multiboxParentJobBuilderIndex = $filter('filter')($scope.runsToInsertList[RunToInsertIndex].jobs, { JobNumber: r.waypoints[j].id.slice(0, -1) + '1' })[0].BuilderIndex ?? 0;

                            if (multiboxParentJobBuilderIndex > 0 && multiboxParentJobBuilderIndex <= j) {
                                runOrder = multiboxParentJobBuilderIndex;
                                $scope.runsToInsertList[RunToInsertIndex].jobs.find(x => x.JobNumber === r.waypoints[j].id).BuilderIndex = runOrder;
                            } else {
                                runOrder++;
                                // Update A job with the current builder index if it doesn't have one yet
                                if ($scope.runsToInsertList[RunToInsertIndex].jobs.find(x => x.JobNumber.toUpperCase() === r.waypoints[j].id.slice(0, -1) + '1')) {
                                    $scope.runsToInsertList[RunToInsertIndex].jobs.find(x => x.JobNumber.toUpperCase() === r.waypoints[j].id.slice(0, -1) + '1').BuilderIndex = runOrder;
                                }

                                $scope.runsToInsertList[RunToInsertIndex].jobs.find(x => x.JobNumber === r.waypoints[j].id).BuilderIndex = runOrder;
                            }
                        } else {
                            runOrder++;
                            if ($scope.runsToInsertList[RunToInsertIndex].jobs && $scope.runsToInsertList[RunToInsertIndex].jobs.find(x => x.JobNumber === r.waypoints[j].id)) {
                                $scope.runsToInsertList[RunToInsertIndex].jobs.find(x => x.JobNumber === r.waypoints[j].id).BuilderIndex = runOrder;
                            }
                            else {
                                //debugger;
                                continue;
                            }
                        }

                        // Add kms and mins for each job
                        $scope.runsToInsertList[RunToInsertIndex].jobs.find(x => x.JobNumber === r.waypoints[j].id).kms = r.interconnections[j].distance / 1000;
                        $scope.runsToInsertList[RunToInsertIndex].jobs.find(x => x.JobNumber === r.waypoints[j].id).mins = parseInt((r.interconnections[j].time / 60).toFixed(0));

                        // Remove jobs from the all jobs list
                        //$scope.runJobsAll.find(x => x.JobNumber === r.waypoints[j].id).BuilderIndex = j + 1;
                        $scope.runJobsAll.find(x => x.JobNumber === r.waypoints[j].id).BuilderIndex = $scope.runsToInsertList[RunToInsertIndex].jobs.find(x => x.JobNumber === r.waypoints[j].id).BuilderIndex;
                        $scope.runJobsAll.find(x => x.JobNumber === r.waypoints[j].id).inBuilder = 1;
                    }

                    // Order run jobs by the run sequences
                    $scope.runsToInsertList[RunToInsertIndex].jobs = $filter('orderBy')($scope.runsToInsertList[RunToInsertIndex].jobs, "BuilderIndex");

                    //// Get total kms and mins fo the run
                    //var totalKms = parseFloat($scope.runsToInsertList[RunToInsertIndex].jobs.reduce((total, amount) => total + amount.kms, 0).toFixed(2));
                    //var totalTime = $scope.runsToInsertList[RunToInsertIndex].jobs.reduce((total, amount) => total + amount.mins, 0);

                    //// Calculate runs 
                    //$scope.calc = {};
                    //var dropExtra = 2 * $scope.runsToInsertList[RunToInsertIndex].jobs.length;
                    //var hourlyRate = 25;
                    //var expPerKm = 0.5;

                    //$scope.calc.totalMins = parseInt(totalTime) + parseInt(dropExtra);
                    //$scope.calc.totalKms = totalKms;
                    //$scope.calc.timeAsHourPercent = Math.round($scope.calc.totalMins / 60 * 100) / 100;
                    //$scope.calc.totalDrops = $scope.runsToInsertList[RunToInsertIndex].jobs.length;
                    //$scope.calc.petrolExpense = $scope.calc.totalDrops * expPerKm;
                    //$scope.calc.totalPayout = Math.round(hourlyRate * $scope.calc.timeAsHourPercent * 100) / 100;
                    //$scope.calc.revenue = parseInt($scope.runsToInsertList[RunToInsertIndex].jobs.reduce((total, amount) => total + amount.Amount, 0));
                    //$scope.calc.courierPercent = (Math.round(($scope.calc.totalPayout / $scope.calc.revenue * 100) * 100) / 100);

                    //if ($scope.calc.courierPercent > 75) {
                    //    $scope.calc.courierPercentColour = "red";
                    //} else if ($scope.calc.courierPercent > 65) {
                    //    $scope.calc.courierPercentColour = "orange";
                    //} else {
                    //    $scope.calc.courierPercentColour = "green";
                    //}

                    //$scope.calc.courierPercent = $scope.calc.courierPercent + "%";

                    $scope.calculateRunDetails($scope.runsToInsertList[RunToInsertIndex].jobs);

                    // Add calculations back to run
                    $scope.runsToInsertList[RunToInsertIndex].courierPercent = angular.copy($scope.calc.courierPercent);
                    $scope.runsToInsertList[RunToInsertIndex].mins = angular.copy($scope.calc.totalMins);
                    $scope.runsToInsertList[RunToInsertIndex].kms = angular.copy($scope.calc.totalKms);

                    // Insert and lock run
                    $scope.toggleRunLock($scope.runsToInsertList[RunToInsertIndex]);
                    // Remove the locked run from the RunsToInsertList
                    $scope.runsToInsertList.splice(RunToInsertIndex, 1);
                }
            });
        };

        // Route and update run via HereManp
        $scope.routeRun = function (runIndex) {

            var run = $scope.runList[runIndex];
            // User the first jobs start point as start and end location, it's Urgent courier in this case
            var start = encodeURIComponent(run.jobs[0].fromLat + "," + run.jobs[0].fromLng);
            //var end = start;
            var destinations = run.jobs.map(function (item) { return encodeURIComponent(item.JobNumber + ";" + item.toLat + "," + item.toLng); });

            // Prepare parameters for HereMap API
            var requestData =
                [
                    "&mode=fastest;car;traffic:disabled;",
                    "&start=", start
                    //"&end=", end
                ];

            for (var i = 0, k = 0; i < destinations.length; i++) {
                if (destinations[i] != null && destinations[i].trim().length > 0) {
                    requestData.push("&destination" + (k + 1) + "=", destinations[i]);
                    k++;
                }
            }

            // String requestDataString
            var requestDataString = requestData.join("");

            // Call HereMap for each runs 
            uRunData.getHereMapSequence(requestDataString).then(function (data) {
                // Display error message if there is any
                if (data.errors != null && data.errors.length > 0) {
                    alert(data.errors[0]);
                    $scope.hideAllLoading();
                    return false;
                }

                if (data.results != null && data.results.length > 0) {

                    var r = data.results[0];

                    //// remove and start and end point routes
                    r.waypoints.splice(0, 1);
                    //r.waypoints.splice(r.waypoints.length - 1, 1);

                    //// remove distance and time from the last job to the base
                    //r.interconnections.splice(r.interconnections.length - 1, 1);

                    // Get the run from the runsToInsertList
                    var jobsToUpdate = $scope.runList[runIndex].jobs;

                    var runOrder = 0;
                    //Insert build index for jobs
                    for (var j = 0; j < r.waypoints.length; j++) {

                        var referenceJobNumber = r.waypoints[j].id;
                        var multiboxParentJobBuilderIndex = 0;
                        // Multiboxes jobs
                        if (referenceJobNumber.substr(referenceJobNumber.length - 2, 1) == "-") {
                            // Keep the same pickup order for multiboxes jobs
                            multiboxParentJobBuilderIndex = $filter('filter')(jobsToUpdate, { JobNumber: r.waypoints[j].id.slice(0, -1) + '1' })[0].BuilderIndex ?? 0;

                            if (multiboxParentJobBuilderIndex > 0 && multiboxParentJobBuilderIndex <= j) {
                                runOrder = multiboxParentJobBuilderIndex;
                                jobsToUpdate.find(x => x.JobNumber === r.waypoints[j].id).BuilderIndex = runOrder;
                            } else {
                                runOrder++;
                                // Update A job with the current builder index if it doesn't have one yet
                                if (jobsToUpdate.find(x => x.JobNumber.toUpperCase() === r.waypoints[j].id.slice(0, -1) + '1')) {
                                    jobsToUpdate.find(x => x.JobNumber.toUpperCase() === r.waypoints[j].id.slice(0, -1) + '1').BuilderIndex = runOrder;
                                }

                                jobsToUpdate.find(x => x.JobNumber === r.waypoints[j].id).BuilderIndex = runOrder;
                            }
                        } else {
                            runOrder++;
                            jobsToUpdate.find(x => x.JobNumber === r.waypoints[j].id).BuilderIndex = runOrder;
                        }

                        //jobsToUpdate.find(x => x.JobNumber === r.waypoints[j].id).BuilderIndex = j + 1;
                        // Add kms and mins for each job
                        jobsToUpdate.find(x => x.JobNumber === r.waypoints[j].id).kms = r.interconnections[j].distance / 1000;
                        jobsToUpdate.find(x => x.JobNumber === r.waypoints[j].id).mins = parseInt((r.interconnections[j].time / 60).toFixed(0));

                        // Remove jobs from the all jobs list
                        //$scope.runJobsAll.find(x => x.JobNumber === r.waypoints[j].id).BuilderIndex = j + 1;
                        $scope.runJobsAll.find(x => x.JobNumber === r.waypoints[j].id).BuilderIndex = jobsToUpdate.find(x => x.JobNumber === r.waypoints[j].id).BuilderIndex;
                        $scope.runJobsAll.find(x => x.JobNumber === r.waypoints[j].id).inBuilder = 1;
                    }

                    // Order run jobs by the run sequences
                    //$scope.runsToInsertList[RunToInsertIndex].jobs = $filter('orderBy')($scope.runsToInsertList[RunToInsertIndex].jobs, "BuilderIndex");
                    jobsToUpdate.sort((a, b) => (a.BuilderIndex > b.BuilderIndex) ? 1 : ((b.BuilderIndex > a.BuilderIndex) ? -1 : 0));

                    //// Get total kms and mins fo the run
                    //var totalKms = parseFloat(jobsToUpdate.reduce((total, amount) => total + amount.kms, 0).toFixed(2));
                    //var totalTime = jobsToUpdate.reduce((total, amount) => total + amount.mins, 0);

                    //// Calculate runs 
                    //$scope.calc = {};
                    //var dropExtra = 2 * jobsToUpdate.length;
                    //var hourlyRate = 25;
                    //var expPerKm = 0.5;

                    //$scope.calc.totalMins = parseInt(totalTime) + parseInt(dropExtra);
                    //$scope.calc.totalKms = totalKms;
                    //$scope.calc.timeAsHourPercent = Math.round($scope.calc.totalMins / 60 * 100) / 100;
                    //$scope.calc.totalDrops = jobsToUpdate.length;
                    //$scope.calc.petrolExpense = $scope.calc.totalDrops * expPerKm;
                    //$scope.calc.totalPayout = Math.round(hourlyRate * $scope.calc.timeAsHourPercent * 100) / 100;
                    //$scope.calc.revenue = parseInt(jobsToUpdate.reduce((total, amount) => total + amount.Amount, 0));
                    //$scope.calc.courierPercent = (Math.round(($scope.calc.totalPayout / $scope.calc.revenue * 100) * 100) / 100);

                    //if ($scope.calc.courierPercent > 75) {
                    //    $scope.calc.courierPercentColour = "red";
                    //} else if ($scope.calc.courierPercent > 65) {
                    //    $scope.calc.courierPercentColour = "orange";
                    //} else {
                    //    $scope.calc.courierPercentColour = "green";
                    //}

                    //$scope.calc.courierPercent = $scope.calc.courierPercent + "%";

                    $scope.calculateRunDetails(jobsToUpdate);

                    // Add calculations back to run
                    $scope.runList[runIndex].jobs = jobsToUpdate;
                    $scope.runList[runIndex].courierPercent = angular.copy($scope.calc.courierPercent);
                    $scope.runList[runIndex].mins = angular.copy($scope.calc.totalMins);
                    $scope.runList[runIndex].kms = angular.copy($scope.calc.totalKms);

                    // Insert and lock run                   
                    $scope.toggleRunLock($scope.runList[runIndex], true); // true = updateRun
                }
            });
        };

        $scope.calculateRunDetails = function (jobs, mins, kms) {
            // TODO: Calculate runs based on the settings from tblSettings
            $scope.calc = {};
            var dropExtra = 2 * jobs.length;
            var hourlyRate = 25;
            var expPerKm = 0.5;

            // Get total kms and mins fo the run
            var totalKms = kms ?? parseFloat(jobs.reduce((total, amount) => total + amount.kms, 0).toFixed(2)); // if kms is not null then use Kms, otherwise, get it from the jobs
            var totalTime = mins ?? jobs.reduce((total, amount) => total + amount.mins, 0);

            $scope.calc.totalMins = mins ?? parseInt(totalTime) + parseInt(dropExtra);
            $scope.calc.totalKms = totalKms;
            $scope.calc.timeAsHourPercent = Math.round($scope.calc.totalMins / 60 * 100) / 100;
            $scope.calc.totalDrops = jobs.length;

            // Expenses
            $scope.calc.petrolExpense = Math.round(totalKms * expPerKm * 100) / 100;
            // TotalPayout = hourlyRate * hours + Expenses
            $scope.calc.totalPayout = Math.round(hourlyRate * $scope.calc.timeAsHourPercent * 100) / 100 + $scope.calc.petrolExpense;
            // Revenue = TotalAmount - PPD
            $scope.calc.revenue = Math.round(parseFloat(jobs.reduce((total, amount) => total + amount.Amount, 0)) / 1.05 * 100) / 100;
            // Courier percentage = total payout / revenue
            //$scope.calc.courierPercent = (Math.round(($scope.calc.totalPayout / $scope.calc.revenue * 100) * 100) / 100) === Infinity ? 0 : Math.round(($scope.calc.totalPayout / $scope.calc.revenue * 100) * 100) / 100; // Math.round(($scope.calc.totalPayout / $scope.calc.revenue * 100) * 100) / 100;
            $scope.calc.courierPercent = $scope.calc.revenue == 0 ? 0 : Math.round(($scope.calc.totalPayout / $scope.calc.revenue * 100) * 100) / 100; // Math.round(($scope.calc.totalPayout / $scope.calc.revenue * 100) * 100) / 100;

            if ($scope.calc.courierPercent > 75) {
                $scope.calc.courierPercentColour = "red";
            } else if ($scope.calc.courierPercent > 65) {
                $scope.calc.courierPercentColour = "orange";
            } else {
                $scope.calc.courierPercentColour = "green";
            }

            $scope.calc.courierPercent = $scope.calc.courierPercent + "%";
        };

        $scope.updateRunDetails = function (mins, kms, drops, order, googleRouteResponse) {
            if ($filter('filter')($scope.runList, { 'isActive': 1 })) {
                //console.log($filter('filter')($scope.runList, {'isActive':1})[0]);
                if ($filter('filter')($scope.runList, { 'isActive': 1 })[0]) {
                    var dropExtra = 2 * drops;
                    $filter('filter')($scope.runList, { 'isActive': 1 })[0].mins = (parseInt(mins) + parseInt(dropExtra));
                    $filter('filter')($scope.runList, { 'isActive': 1 })[0].kms = kms;

                    angular.forEach(order, function (value, key) {

                        var toCompare = [];

                        angular.forEach($scope.runBuilder, function (job2, key2) {

                            toCompare.push([key2, job2.toLat, job2.toLng]);

                        });

                        var closestIndex = closestLocation(value.lat, value.lng, toCompare);

                        var closestJob = $scope.runBuilder[closestIndex[0]];

                        //Add run order into the current run builder jobs, start from 1
                        closestJob.BuilderIndex = key + 1;
                    });

                    //Find unOrdered jobs in the builder, and match it back from the orders
                    var unBuildeJobs =
                        $scope.runBuilder.filter(j => j.BuilderIndex == null || j.BuilderIndex == "undefined");
                    angular.forEach(unBuildeJobs, function (value, key) {

                        var toCompare = [];
                        angular.forEach(order, function (job, key2) {
                            toCompare.push([key2, job.lat, job.lng]);
                        });

                        var closestIndex = closestLocation(value.toLat, value.toLng, toCompare);
                        //Add run order into the current run builder jobs, start from 1
                        value.BuilderIndex = closestIndex[0] + 1;
                    });


                    ////Set the order for the first and the last job
                    //$scope.runBuilder[0].BuilderIndex = 0;
                    //$scope.runBuilder[$scope.runBuilder.length - 1].BuilderIndex = $scope.runBuilder.length;
                    //for (var i = 0; i < order.length; i++) {
                    //     $scope.runBuilder[order[i] + 1].BuilderIndex = i + 1;
                    //}

                    // Sort jobs by the run order
                    $scope.runBuilder = $filter('orderBy')($scope.runBuilder, "BuilderIndex");

                    // Replace the jobs in the current selected runList with the routed order
                    $filter('filter')($scope.runList, { 'isActive': 1 })[0].jobs = $scope.runBuilder;

                    //$filter('filter')($scope.runList, {'isActive':1})[0].GoogleRouteResponse = googleRouteResponse;
                    $filter('filter')($scope.runList, { 'isActive': 1 })[0].RunChanged = false;

                    // Auto lock the run after routing 
                    $scope.toggleRunLock($filter('filter')($scope.runList, { 'isActive': 1 })[0]);

                    setTimeout(function () { $scope.runBuilderTotals(); $scope.$apply(); }, 0);

                }
            }
        };

        $scope.showRun = function (run, manualRoute) {

            $scope.runBuilder = run.jobs;
            // Filter run jobs by the run order
            $scope.runBuilder = $filter('orderBy')($scope.runBuilder, "BuilderIndex");

            $scope.activeRunName = run.name;
            $scope.isVoidRunActive = (run.isVoidRun === true);

            var isDraggable = $(".droppable-box").hasClass("ui-draggable");
            if (run.locked == 1) {
                if (isDraggable) {
                    setTimeout(function () { $(".droppable-box").droppable("option", "disabled", true); }, 0);
                }
            } else {
                if (isDraggable) {
                    $scope.activateRunDrop();
                    setTimeout(function () { $(".droppable-box").droppable("option", "disabled", false); }, 0);
                }

            }

            if ($filter('filter')($scope.runList, { 'isActive': 1 })[0]) {
                $filter('filter')($scope.runList, { 'isActive': 1 })[0].isActive = 0;
            }

            run.isActive = 1;

            $scope.updateRun(run);
            //$scope.getPotentialCouriers();

            if (!localStorage.getItem('runList') && manualRoute) {
                $scope.updatePotentialJobs(manualRoute);
            }

        };

        ////////////////////////////////////////////////////////////////////////////////////////////////////////////////

        $scope.potentialJobs = [];

        $scope.showJobs = function (group) {

            $("#box-jobsList").find(".loading").show();
            $scope.jobList = group.jobs;
            setTimeout(function () { sizeHeadings($("#jobList").parents(".column")); }, 1000);
            $("#box-jobsList .loading").fadeOut();

            $scope.updatePotentialJobs();

        };

        $scope.updatePotentialJobs = function (manualRoute) {

            $scope.potentialJobs = [];

            angular.forEach($scope.jobList, function (value, key) {
                if (value.inBuilder != 1 && value.toLat) {
                    $scope.potentialJobs.push({ "lat": value.toLat, "lng": value.toLng, "jn": value.JobNumber, "jobID": value.BulkJobID });
                }
            });

            $scope.multiSelectedRuns = []
            $scope.multiSelectedRunsJobs = []
            $("#box-runList .active").each(function (index) {
                var markerColors = ["#ff9000", "#00a3ff", "#ffff00", "#b13cff"]; // blue, purple, orange, yellow
                let currentRun = $(this).scope().run;

                if (!currentRun.isActive) { //&& currentRun.locked == 1) {   
                    // Add all selected runs into the dropdown list
                    $scope.multiSelectedRuns.push({ id: currentRun.ID, label: currentRun.name, color: markerColors[index % markerColors.length] });
                    if (currentRun.jobs.length > 0) {
                        angular.forEach(currentRun.jobs, function (job, key) {
                            if (job.toLat && job.toLng) {
                                $scope.multiSelectedRunsJobs.push({ lat: job.toLat, lng: job.toLng, ro: job.BuilderIndex, color: markerColors[index % markerColors.length], runid: currentRun.ID, jn: job.JobNumber, jobID: job.BulkJobID, runID: currentRun.ID });
                            }
                        });
                    }
                    // Set run color
                    $filter('filter')($scope.runList, { 'ID': currentRun.ID })[0].runColor = { 'background-color': markerColors[index % markerColors.length] };
                } else {
                    // Add the current active run into the list with red color
                    $scope.multiSelectedRuns.push({ id: currentRun.ID, label: currentRun.name, color: "#ea4335" });
                }
            });

            setTimeout(function () {
                var onlyDrawMarks = true;
                if ($scope.routeSetting.autoRoute || manualRoute == true) {
                    onlyDrawMarks = false;
                }

                // Replace with HereMap
                calcRoute(onlyDrawMarks);
            }, 0);
        };




        $scope.getData = function (clearStorage) {

            if (clearStorage === 1) {
                localStorage.removeItem('runList');
                //$scope.localStorage();
            }

            ///////////////////////////////
            // JOB LIST
            ///////////////////////////////

            //Get Job Data
            $scope.jobList = [];
            $scope.courierList = [];
            $scope.currentJob = false;
            $scope.courierFleets = false;
            $scope.potentialCouriers = false;
            $scope.jobGroups = false;
            $scope.selectedJobGroups = [];
            $scope.jobsCurrentList = false;
            $scope.currentCourier = false;
            $scope.runNameGroups = [];
            $scope.runNameJobsGroups = [];
            $scope.runJobsAllByPostalCodeRunName = [];
            $scope.couriers = [];
            $scope.bulkRuns = {};
            $scope.routeSetting = {
                "autoRoute": false
            };

            $("#box-groupedJobs").find(".loading").show();

            //$scope.selectedClients = $scope.pickDateService.clients.map(a => a.id);
            var selectedClients = $scope.pickDateService.clients.map(a => a.id);
            var selectedRegions = $scope.pickDateService.regions.map(a => a.id);
            var selectedOurRefs = $scope.pickDateService.ourRefs;
            var selectedSpeeds = $scope.pickDateService.speeds.map(a => a.id);

            uRunData.getRunJobsAll(moment($scope.pickDateService.date), selectedClients, selectedRegions, selectedOurRefs, selectedSpeeds).then(function (data) {
                //$("#box-groupedJobs .loading").fadeOut();
                $scope.runJobsAll = data;
                //$scope.pickClients = data.Clients;

                // Get Protential couriers then
                uRunData.getPotentialCouriers($scope.selectedJobs).then(function (data) {

                    var members = data;
                    $scope.couriers = data;

                    var groups = members.reduce(function (obj, item) {
                        obj[item.Fleet] = obj[item.Fleet] || [];
                        obj[item.Fleet].push(item);
                        return obj;
                    }, {});

                    var myArray = Object.keys(groups).map(function (key) {
                        return { name: key, couriers: groups[key] };
                    });

                    $scope.fleetGroups = myArray;
                    $scope.courierFleets = true;


                    //Set headings
                    //setTimeout(function(){ sizeHeadings($("#potentialCouriers").parents(".column")); }, 1000);
                    setTimeout(function () { sizeHeadings($("#potentialCouriers").parents(".column")); }, 2000);

                    $("#box-potentialCourierFleets .loading").fadeOut();


                    setTimeout(function () {
                        //$("#box-groupedJobs .loading").fadeOut();
                    }, 100);


                    // Get runs from database
                    uRunData.doGetAPI("Job/GetBulkRuns?datetime=" + moment($scope.pickDateService.date).format("YYYY-MM-DD") + '&clientIds=' + selectedClients + '&regionIds=' + selectedRegions + '&ourRefs=' + selectedOurRefs + '&Speeds=' +
                        selectedSpeeds).then(function (data) {
                            var bulkRuns = data.response;

                            // Group runs by ID
                            var bulkRunGroups = bulkRuns.reduce(function (obj, item) {
                                obj[item.ID] = obj[item.ID] || [];
                                obj[item.ID].push(item);
                                return obj;
                            }, {});
                            // Group run jobs by ID
                            var bulkRunJobsGroups = bulkRuns.reduce(function (obj, item) {
                                try {
                                    obj[item.ID] = obj[item.ID] || [];
                                    var job = $filter('filter')($scope.runJobsAll, j => j.BulkJobID == item.BulkJobID)[0];
                                    if (job != null) {
                                        job.RunOrder = item.RunOrder;
                                        obj[item.ID].push(job);
                                    }
                                } catch (e) {
                                    throw e.message;
                                }

                                return obj;
                            }, {});

                            // Conbine runs and jobs
                            var bulkRunJobsGroupsArray = Object.keys(bulkRunGroups).map(function (key) {
                                var item = $filter('filter')(bulkRuns, j => j.ID == key)[0];
                                var isVoid = (item.name === "Void Jobs");
                                return {
                                    ID: item.ID,
                                    name: item.name,
                                    courier: {
                                        courier: item.Courier,
                                        Fleet: item.Fleet,
                                        courierID: item.CourierID
                                    },
                                    locked: 1,
                                    courierPercent: item.CourierPercentage,
                                    kms: item.Kms,
                                    mins: item.Mins,
                                    jobs: bulkRunJobsGroups[key],
                                    status: item.Status,
                                    isVoidRun: isVoid
                                };
                            });

                            $scope.bulkRuns = bulkRunJobsGroupsArray;

                            //$scope.buildRunByPostalCode();

                            $scope.sortByTime();

                            $scope.localStorage();

                            $("#box-groupedJobs .loading").fadeOut();
                        });
                });

                //setTimeout(function(){ $("#box-groupedJobs .loading").fadeOut(); }, 100);	
                //$scope.sortByTime();
                //$scope.localStorage();
            });

            $scope.runsToInsertList = [];
            $scope.buildRunByPostalCode = function () {
                $("#box-groupedJobs").find(".loading").show();
                $("#box-runList").find(".loading").show();
                $("#box-runBuilder").find(".loading").show();
                $("#box-map").find(".loading").show();

                // Get all selected jobs
                var selectedGroupJobsList = [];
                $("#jobsGroup .active").each(function () {
                    if ($(this).attr("data-isGroup") == 1) {
                        selectedGroupJobsList.push($(this).scope().grouped.jobs.filter(x => x.inBuilder != 1));
                    }
                });
                var selectedJobs = [].concat.apply([], selectedGroupJobsList);

                // Alert if there is any invalid unlocked jobs
                if ($filter('filter')(selectedJobs, j => j.PrefixRunName === null || j.toLat === null || j.ToPostCode === null).length > 0) {
                    var errorString = "";
                    var newLine = "\r\n";
                    // Return detail errors
                    if ($filter('filter')(selectedJobs, j => j.PrefixRunName === null).length > 0) {
                        errorString += "No RunName Found with PostCode: " + [...new Set($filter('filter')(selectedJobs, j => j.PrefixRunName === null).map(x => x.ToPostCode))].sort().toString();
                        errorString += newLine;
                    }

                    if ($filter('filter')(selectedJobs, j => j.toLat === null || j.ToPostCode === null).length > 0) {
                        errorString += "No GeoCode with Jobs: " + [...new Set($filter('filter')(selectedJobs, j => j.toLat === null || j.ToPostCode === null).map(x => x.JobNumber))].sort().toString();
                        errorString += newLine;
                    }

                    alert(errorString);
                    return false;
                }

                // Get all un-locked run jobs with Postal Code
                var unLockedJobs = $filter('filter')(selectedJobs, j => typeof j.PrefixRunName !== 'undefined' && j.PrefixRunName && j.BulkJobRunID === 0);

                // Group all jobs by PostalCode
                $scope.runJobsAllByPostalCodeRunName = unLockedJobs.reduce(function (obj, item, index, array) {
                    if (item.ToPostCode !== 0) {
                        obj[item.PrefixRunName] = obj[item.PrefixRunName] || [];
                        obj[item.PrefixRunName].push(item);
                    }
                    return obj;
                }, {});

                // Build runs
                $scope.getGroupedJobsHereMapSequence();
            };

            $scope.hideAllLoading = function () {
                $("#box-groupedJobs").find(".loading").fadeOut();
                $("#box-runList").find(".loading").fadeOut();
                $("#box-runBuilder").find(".loading").fadeOut();
                $("#box-map").find(".loading").fadeOut();
                return false;
            }

            $scope.getGroupedJobsHereMapSequence = function () {
                // End the call when runJobsAllByPostalCodeRunName does't have any jobs left
                if (Object.keys($scope.runJobsAllByPostalCodeRunName).length === 0) {
                    $scope.hideAllLoading();
                    return false;
                }

                var key = Object.keys($scope.runJobsAllByPostalCodeRunName)[0];
                var currentJobs = $scope.runJobsAllByPostalCodeRunName[key];

                /// Use RouteSavvy for jobs over 200
                if (currentJobs.length > 200) {
                    // Use RouteSavvy to get the orders

                    var locations = currentJobs.map((j) => ({ Name: j.JobNumber, Latitude: j.toLat, Longitude: j.toLng, VisitDurationInMinutes: 0 }));
                    var start = { Name: currentJobs[0].JobNumber, Latitude: currentJobs[0].fromLat, Longitude: currentJobs[0].fromLng, VisitDurationInMinutes: 0 };
                    locations.unshift(start);
                    var requestData = JSON.stringify(locations);

                    // Call RouteSavvy
                    uRunData.getRouteSavvyWithName(requestData).then(function (data) {
                        if (data !== null && data.routes.length > 0) {

                            var r = data.routes;
                            // remove start to get actual jobs sequences
                            r.splice(0, 1);

                            //Insert build index for jobs
                            for (var j = 0; j < r.length; j++) {
                                $scope.runJobsAllByPostalCodeRunName[key].find(x => x.JobNumber == r[j].name).BuilderIndex = j + 1;
                            }

                            //Devide runNameGroups jobs into 20 by default for each runs
                            $scope.runJobsAllByPostalCodeRunName[key] = $filter('orderBy')($scope.runJobsAllByPostalCodeRunName[key], "BuilderIndex");

                            var dividedRunGroups = [];
                            while ($scope.runJobsAllByPostalCodeRunName[key].length) {
                                //// Merge the last few jobs into the second last run group
                                // Remove merge by Steve request
                                if (dividedRunGroups.length && $scope.runJobsAllByPostalCodeRunName[key].length && $scope.runJobsAllByPostalCodeRunName[key].length < $scope.runJobsAllByPostalCodeRunName[key][0].MaxJobsPerRun) {
                                    if ($scope.runJobsAllByPostalCodeRunName[$scope.runJobsAllByPostalCodeRunName[key][0].PostCodeMergeTo] && $scope.runJobsAllByPostalCodeRunName[key][0].PostCodeMergeTo) {
                                        $scope.runJobsAllByPostalCodeRunName[$scope.runJobsAllByPostalCodeRunName[key][0].PostCodeMergeTo] =
                                            $scope.runJobsAllByPostalCodeRunName[$scope.runJobsAllByPostalCodeRunName[key][0].PostCodeMergeTo].concat(
                                                $scope.runJobsAllByPostalCodeRunName[key].splice(0, $scope.runJobsAllByPostalCodeRunName[key][0].MaxJobsPerRun));
                                    } else {
                                        dividedRunGroups.push($scope.runJobsAllByPostalCodeRunName[key].splice(0, $scope.runJobsAllByPostalCodeRunName[key][0].MaxJobsPerRun));
                                    }
                                } else {
                                    dividedRunGroups.push($scope.runJobsAllByPostalCodeRunName[key].splice(0, $scope.runJobsAllByPostalCodeRunName[key][0].MaxJobsPerRun));
                                }
                            }

                            var labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                            var result = dividedRunGroups.map(function (v, i) {

                                var runNameSuffix = labels[i % labels.length];
                                //// Change to user A1,A2, B1, B2 for run names rather then A1-A, A1-B
                                //var run = { name: key + "-" + runNameSuffix, jobs: dividedRunGroups[i] };
                                var run = { name: key + runNameSuffix, jobs: dividedRunGroups[i] };
                                //var run = { name: runNameSuffix + (i+1).toString(), jobs: dividedRunGroups[i] };
                                // Store runs for insert laters
                                $scope.runsToInsertList.push(run);
                                return run;
                            });

                            // flatten runNameGroupsArrays; 
                            $scope.runNameJobsGroups = [].concat.apply([], result);

                            // Conbine the empty run with the courier groups run and display in the Run List section
                            $scope.runList.push.apply($scope.runList, $scope.runNameJobsGroups);

                            // This code runs into a loop and create runs to keep inserting itself
                            for (var i = 0; i < $scope.runsToInsertList.length; i++) {
                                $scope.updateRunDetailsFromRun($scope.runsToInsertList[i]);
                            }

                            // Remove the current jobs from the runJobsAllByPostalCodeRunName
                            delete $scope.runJobsAllByPostalCodeRunName[key];

                            // Call HereMap again to get each postCode run squences
                            $scope.getGroupedJobsHereMapSequence();
                        }
                    });

                } else {
                    // User the first jobs start point as start and let HereMap to choose the destination 
                    var start = encodeURIComponent(currentJobs[0].fromLat + "," + currentJobs[0].fromLng);
                    //var end = start;
                    var destinations = currentJobs.map(function (item) { return encodeURIComponent(item.JobNumber + ";" + item.toLat + "," + item.toLng); });

                    // Prepare parameters for HereMap API
                    var requestData =
                        [
                            "&mode=fastest;car;traffic:disabled;"
                            , "&start=", start
                            //,"&end=", end // Omit the end location to avoid routing back to base
                        ];

                    for (var i = 0, k = 0; i < destinations.length; i++) {
                        if (destinations[i] !== null && destinations[i].trim().length > 0) {
                            requestData.push("&destination" + (k + 1) + "=", destinations[i]);
                            k++;
                        }
                    }

                    // String requestDataString
                    var requestDataString = requestData.join("");

                    // Get total squences from Heremap
                    uRunData.getHereMapSequence(requestDataString).then(function (data) {
                        // Display error message if there is any
                        if (data.errors != null && data.errors.length > 0) {
                            alert(data.errors[0]);
                            $scope.hideAllLoading();
                            return false;
                        }

                        if (data.results !== null && data.results.length > 0) {

                            var r = data.results[0];
                            // remove start to get actual jobs sequences
                            r.waypoints.splice(0, 1);
                            //r.waypoints.splice(r.waypoints.length - 1, 1);

                            // remove distance and time from the location of last job to the base
                            //r.interconnections.splice(r.interconnections.length - 1, 1);

                            //Insert build index for jobs
                            for (var j = 0; j < r.waypoints.length; j++) {

                                $scope.runJobsAllByPostalCodeRunName[key].find(x => x.JobNumber == r.waypoints[j].id).BuilderIndex = j + 1;
                                //$scope.runJobsAll.find(x => x.JobNumber == r.waypoints[j].id).BuilderIndex = j + 1;
                                //$scope.runJobsAll.find(x => x.JobNumber == r.waypoints[j].id).inBuilder = 1;
                            }

                            //Devide runNameGroups jobs into 20 by default for each runs
                            $scope.runJobsAllByPostalCodeRunName[key] = $filter('orderBy')($scope.runJobsAllByPostalCodeRunName[key], "BuilderIndex");

                            var dividedRunGroups = [];
                            while ($scope.runJobsAllByPostalCodeRunName[key].length) {
                                //// Merge the last few jobs into the second last run group
                                // Remove merge by Steve request
                                if (dividedRunGroups.length && $scope.runJobsAllByPostalCodeRunName[key].length && $scope.runJobsAllByPostalCodeRunName[key].length < $scope.runJobsAllByPostalCodeRunName[key][0].MaxJobsPerRun) {
                                    if ($scope.runJobsAllByPostalCodeRunName[$scope.runJobsAllByPostalCodeRunName[key][0].PostCodeMergeTo] && $scope.runJobsAllByPostalCodeRunName[key][0].PostCodeMergeTo) {
                                        $scope.runJobsAllByPostalCodeRunName[$scope.runJobsAllByPostalCodeRunName[key][0].PostCodeMergeTo] =
                                            $scope.runJobsAllByPostalCodeRunName[$scope.runJobsAllByPostalCodeRunName[key][0].PostCodeMergeTo].concat(
                                                $scope.runJobsAllByPostalCodeRunName[key].splice(0, $scope.runJobsAllByPostalCodeRunName[key][0].MaxJobsPerRun));
                                    } else {
                                        dividedRunGroups.push($scope.runJobsAllByPostalCodeRunName[key].splice(0, $scope.runJobsAllByPostalCodeRunName[key][0].MaxJobsPerRun));
                                    }
                                } else {
                                    dividedRunGroups.push($scope.runJobsAllByPostalCodeRunName[key].splice(0, $scope.runJobsAllByPostalCodeRunName[key][0].MaxJobsPerRun));
                                }
                            }

                            var labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                            var result = dividedRunGroups.map(function (v, i) {

                                var runNameSuffix = labels[i % labels.length];
                                //// Change to user A1,A2, B1, B2 for run names rather then A1-A, A1-B
                                //var run = { name: key + "-" + runNameSuffix, jobs: dividedRunGroups[i] };
                                var run = { name: key + runNameSuffix, jobs: dividedRunGroups[i] };
                                //var run = { name: runNameSuffix + (i+1).toString(), jobs: dividedRunGroups[i] };
                                // Store runs for insert laters
                                $scope.runsToInsertList.push(run);
                                return run;
                            });

                            // flatten runNameGroupsArrays; 
                            $scope.runNameJobsGroups = [].concat.apply([], result);

                            // Conbine the empty run with the courier groups run and display in the Run List section
                            $scope.runList.push.apply($scope.runList, $scope.runNameJobsGroups);

                            // This code runs into a loop and create runs to keep inserting itself
                            for (var i = 0; i < $scope.runsToInsertList.length; i++) {
                                $scope.updateRunDetailsFromRun($scope.runsToInsertList[i]);
                            }

                            // Remove the current jobs from the runJobsAllByPostalCodeRunName
                            delete $scope.runJobsAllByPostalCodeRunName[key];

                            // Call HereMap again to get each postCode run squences
                            $scope.getGroupedJobsHereMapSequence();
                        }
                    });
                }

            };

            $scope.sortByTime = function () {

                // Exclude voided jobs from grouping
                var members = $filter('filter')($scope.runJobsAll, function (j) { return !j.Void; });

                //// Move auto group into the build run button function: $scope.buildRunByPostalCode()
                //// Add RunName jobs groups
                //$scope.runNameJobs = $filter('filter')(members, j => j.PrefixRunName != null && j.PrefixRunName.trim().length > 0 && j.BulkJobRunID == 0);
                //// Add jobs into courierJobsGroups
                //var runNameGroups = $scope.runNameJobs.reduce(function (obj, item) {
                //    obj[item.PrefixRunName] = obj[item.PrefixRunName] || [];
                //    obj[item.PrefixRunName].push(item);
                //    return obj;
                //}, {});               

                ////Devide runNameGroups jobs into 20 by default for each runs
                //var runNameGroupsArray = Object.keys(runNameGroups).map(function (key) {
                //    var dividedRunGroups = [];
                //    while (runNameGroups[key].length) {
                //        // Merge the last few jobs into the second last run group
                //        if (dividedRunGroups.length &&  runNameGroups[key].length && runNameGroups[key].length < runNameGroups[key][0].MaxJobsPerRun) {
                //            dividedRunGroups[dividedRunGroups.length - 1] = dividedRunGroups[dividedRunGroups.length - 1].concat(
                //                runNameGroups[key].splice(0, runNameGroups[key][0].MaxJobsPerRun));
                //        } else {
                //            dividedRunGroups.push(runNameGroups[key].splice(0, runNameGroups[key][0].MaxJobsPerRun));
                //            }
                //        }

                //    var labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                //    var result = dividedRunGroups.map(function(v,i) {
                //        // return  { name: key + "-" + (i+1) , jobs: dividedRunGroups[i]}
                //        var runNameSuffix = labels[ i % labels.length];
                //        return { name: key + "-" + runNameSuffix, jobs: dividedRunGroups[i] };
                //    });

                //    return result;
                //});

                //// flatten runNameGroupsArrays; 
                //$scope.runNameJobsGroups = [].concat.apply([], runNameGroupsArray);

                // Add courier jobs groups, exclude jobs have runName
                $scope.courierJobs = $filter('filter')(members, j => j.CourierID != null && j.CourierID > 0 && !j.RunName && j.BulkJobRunID == 0);
                // Add jobs into courierJobsGroups
                var courierGroups = $scope.courierJobs.reduce(function (obj, item) {
                    obj[item.CourierID] = obj[item.CourierID] || [];
                    obj[item.CourierID].push(item);
                    return obj;
                }, {});
                var courierJobsGroupsArray = Object.keys(courierGroups).map(function (key) {
                    return { name: key, jobs: courierGroups[key] };
                });
                $scope.courierJobsGroup = courierJobsGroupsArray;

                var groups = members.reduce(function (obj, item) {
                    obj[item.ReadyTime] = obj[item.ReadyTime] || [];
                    obj[item.ReadyTime].push(item);
                    return obj;
                }, {});

                var myArray = Object.keys(groups).map(function (key) {
                    return { name: key, jobs: groups[key] };
                });

                $scope.groupedJobs = myArray;

                setTimeout(function () { sizeHeadings($("#jobList").parents(".column")); }, 100);

                $scope.sortingByTime = true;

            };

            $scope.setTime = function () {
                $scope.filterTimes = [];

                //Check no more than one hour between. 
                var date_sort_asc = function (date1, date2) {
                    // This is a comparison function that will result in dates being sorted in
                    // ASCENDING order. As you can see, JavaScript's native comparison operators
                    // can be used to compare dates. This was news to me.
                    if (date1 > date2) return 1;
                    if (date1 < date2) return -1;
                    return 0;
                };


                setTimeout(function () {

                    $("#jobsGroup .active").each(function () {
                        $(this).find(".addTime").click();
                    });
                    var dates = [];
                    angular.forEach($scope.filterTimes, function (value, key) {

                        var date = new Date;
                        valueSplit = value.split(":");

                        date.setHours(valueSplit[0]);
                        date.setMinutes(valueSplit[1]);
                        date.setSeconds(valueSplit[2]);
                        dates.push(date);

                    });

                    dates.sort(date_sort_asc);


                    var oneHour = 60 * 60 * 1000; /* ms */

                    if ((dates[dates.length - 1].getTime() - dates[0].getTime()) > oneHour) {
                        alert("WARNING: The time range you have picked is an hour or greater!");
                    }

                    //$scope.sortByLessThan100();
                    $scope.sortByPostCode();
                }, 0);



            };

            $scope.clearSortByTime = function () {

                $scope.filterTimes = [];
                $scope.sortByTime();
                $scope.sortingByTime = true;
            };

            $scope.addTime = function (time) {
                $scope.filterTimes.push(time);
            };

            $scope.filterByTimes = function (jobs) {
                return ($scope.filterTimes.indexOf(jobs.ReadyTime) !== -1);
            };

            //$scope.sortByLessThan100 = function() {

            //	var members = $filter('filter')($scope.runJobsAll, $scope.filterByTimes);   

            //	var groups = members.reduce(function(obj,item){
            //	    obj[item.RunLessThan100] = obj[item.RunLessThan100] || [];
            //	    obj[item.RunLessThan100].push(item);
            //	    return obj;
            //	}, {});

            //	var myArray = Object.keys(groups).map(function(key){
            //	    return {name: key, jobs: groups[key]};
            //	});

            //	$scope.groupedJobs = myArray;

            //	setTimeout(function(){ sizeHeadings($("#jobList").parents(".column")); }, 100);

            //	$scope.sortingByTime = false;


            //	setTimeout(function(){ 	$scope.$apply(); }, 0);

            //}



            $scope.sortByPostCode = function () {
                var members = $filter('filter')($scope.runJobsAll, $scope.filterByTimes);

                var groups = members.reduce(function (obj, item) {
                    obj[item.ToPostCode] = obj[item.ToPostCode] || [];
                    obj[item.ToPostCode].push(item);
                    return obj;
                }, {});

                var myArray = Object.keys(groups).map(function (key) {

                    var keyName = key;
                    if (keyName == 0) {
                        keyName = "Non-PostCode";
                    }

                    return {
                        name: keyName,
                        jobs: groups[key],
                        suburbNames: groups[key].map(e => e.ToSuburb).filter(function (elem, index, self) {
                            return index == self.indexOf(elem);
                        }).join(", ")
                    }
                });

                $scope.groupedJobs = myArray;

                setTimeout(function () { sizeHeadings($("#jobList").parents(".column")); }, 100);

                $scope.sortingByTime = false;


                setTimeout(function () { $scope.$apply(); }, 0);

            }

            $scope.sortByMoreThan100 = function () {

                //avar members = $scope.runJobsAll;
                var members = $filter('filter')($scope.runJobsAll, $scope.filterByTimes);

                var groups = members.reduce(function (obj, item) {
                    obj[item.RunMoreThan100] = obj[item.RunMoreThan100] || [];
                    obj[item.RunMoreThan100].push(item);
                    return obj;
                }, {});

                var myArray = Object.keys(groups).map(function (key) {
                    return { name: key, jobs: groups[key] };
                });

                $scope.groupedJobs = myArray;

                setTimeout(function () { sizeHeadings($("#jobList").parents(".column")); }, 100);

                $scope.sortingByTime = false;
            }

            $scope.groupedJobsMenu = [
                {
                    text: 'Edit Group Date',
                    click: function ($itemScope, $event, modelValue, text, $li) {
                        var jobs = $itemScope.grouped.jobs;

                        if (!jobs || jobs.length === 0) {
                            alert("No jobs in this group to update.");
                            return;
                        }

                        // Get the current date from the first job in the group, or use today's date as fallback
                        var currentDateString = moment().format("YYYY-MM-DD");
                        var currentDateObj = new Date();

                        if (jobs.length > 0) {
                            var firstJobDate = jobs[0].DeliveryDate;
                            if (firstJobDate) {
                                // Parse the DD/MM/YYYY format and convert to Date object
                                var parsedMoment = moment(firstJobDate, 'DD/MM/YYYY');
                                if (parsedMoment.isValid()) {
                                    currentDateString = parsedMoment.format("YYYY-MM-DD");
                                    currentDateObj = parsedMoment.toDate();
                                }
                            }
                        }

                        $scope.gather.form = {
                            id: "editGroupRouteDate",
                            title: "Edit Group Date",
                            fields: [
                                {
                                    "name": "groupRouteDate",
                                    "label": "Group Date",
                                    "value": currentDateObj, // Always use Date object
                                    "type": "date",
                                    "groupName": $itemScope.grouped.name,
                                    "jobCount": jobs.length
                                }
                            ],
                            onSubmit: function () {
                                var newDateValue = $scope.gather.form.fields[0].value;
                                var groupName = $scope.gather.form.fields[0].groupName;
                                var jobCount = $scope.gather.form.fields[0].jobCount;

                                if (jobCount === 0) {
                                    alert("No jobs in this group to update.");
                                    return;
                                }

                                // Ensure we have a valid Date object
                                var dateForProcessing;
                                if (newDateValue instanceof Date) {
                                    dateForProcessing = newDateValue;
                                } else if (typeof newDateValue === 'string') {
                                    dateForProcessing = new Date(newDateValue);
                                } else {
                                    alert("Invalid date selected. Please try again.");
                                    return;
                                }

                                // Validate the date
                                if (isNaN(dateForProcessing.getTime())) {
                                    alert("Invalid date selected. Please try again.");
                                    return;
                                }

                                // Convert to API format (YYYY-MM-DD)
                                var dateForApi = moment(dateForProcessing).format("YYYY-MM-DD");

                                // Confirm the bulk update
                                var confirmMessage = "Are you sure you want to update the delivery date for all " +
                                    jobCount + " jobs in group '" + groupName + "' to " +
                                    moment(dateForProcessing).format("DD/MM/YYYY") + "?";

                                if (confirm(confirmMessage)) {
                                    $scope.bulkUpdateGroupRouteDate(jobs, groupName, dateForApi);
                                }
                            },
                            submitValue: "Update Date"
                        };
                        $scope.gather.showForm();
                    },
                    // Only show for groups that have jobs
                    enabled: function ($itemScope, $event, modelValue, text, $li) {
                        return $itemScope.grouped.jobs && $itemScope.grouped.jobs.length > 0;
                    }
                },
                // Existing: Create run from group
                {
                    text: 'Create run from group',
                    click: function ($itemScope, $event, modelValue, text, $li) {
                        $scope.newRun($itemScope.grouped.jobs);
                    }
                }
            ];

            // Add this new function to handle bulk update for grouped jobs
            $scope.bulkUpdateGroupRouteDate = function (jobs, groupName, newDate) {
                if (!jobs || jobs.length === 0) {
                    alert("No jobs in this group to update.");
                    return;
                }

                // Show loading indicator
                $("#box-groupedJobs").find(".loading").show();

                // Prepare the request data
                var jobIds = jobs.map(function (job) {
                    return job.BulkJobID;
                });

                var requestData = {
                    JobIds: jobIds,
                    NewDate: newDate,
                    RunName: groupName + " Group" // Add "Group" to distinguish from runs
                };

                console.log("Sending bulk group update request:", requestData);

                // Call the bulk update API
                uRunData.doAPI("Job/BulkUpdateRouteDate", JSON.stringify(requestData)).then(function (data) {
                    $("#box-groupedJobs").find(".loading").fadeOut();

                    if (data && data.response) {
                        var result = data.response;
                        var message = result.Message || "Date update completed!";
                        var successCount = result.Success || 0;
                        var failedCount = result.Failed || 0;

                        // Show detailed results if there were any failures
                        if (failedCount > 0) {
                            message += "\n\nFailed jobs:";
                            if (result.Details) {
                                var failedJobs = result.Details.filter(function (d) { return d.Result === "Failed"; });
                                failedJobs.forEach(function (failure) {
                                    message += "\n- " + failure.Message;
                                });
                            }
                        }

                        alert(message);

                        // If any jobs were successfully updated, refresh all data
                        if (successCount > 0) {
                            console.log("Refreshing all data after successful group bulk date update");
                            $scope.getData(1); // Complete refresh
                        }
                    } else {
                        console.error("Unexpected response format:", data);
                        alert("Unexpected response from server. Please try again.");
                    }
                }).catch(function (error) {
                    $("#box-groupedJobs").find(".loading").fadeOut();
                    console.error("Error during group bulk date update:", error);
                    alert("An error occurred while updating dates. Please check the console for details.");
                });
            };

            $scope.groupedTimeMenu = [
                // NEW: Edit Route Date
                {
                    text: 'Edit Group Date',
                    click: function ($itemScope, $event, modelValue, text, $li) {
                        var jobs = $itemScope.grouped.jobs;

                        if (!jobs || jobs.length === 0) {
                            alert("No jobs in this time group to update.");
                            return;
                        }

                        // Get the current date from the first job in the group, or use today's date as fallback
                        var currentDateString = moment().format("YYYY-MM-DD");
                        var currentDateObj = new Date();

                        if (jobs.length > 0) {
                            var firstJobDate = jobs[0].DeliveryDate;
                            if (firstJobDate) {
                                // Parse the DD/MM/YYYY format and convert to Date object
                                var parsedMoment = moment(firstJobDate, 'DD/MM/YYYY');
                                if (parsedMoment.isValid()) {
                                    currentDateString = parsedMoment.format("YYYY-MM-DD");
                                    currentDateObj = parsedMoment.toDate();
                                }
                            }
                        }

                        $scope.gather.form = {
                            id: "editTimeGroupRouteDate",
                            title: "Edit Group Date",
                            fields: [
                                {
                                    "name": "timeGroupRouteDate",
                                    "label": "Group Date",
                                    "value": currentDateObj, // Always use Date object
                                    "type": "date",
                                    "groupName": $itemScope.grouped.name,
                                    "jobCount": jobs.length
                                }
                            ],
                            onSubmit: function () {
                                var newDateValue = $scope.gather.form.fields[0].value;
                                var groupName = $scope.gather.form.fields[0].groupName;
                                var jobCount = $scope.gather.form.fields[0].jobCount;

                                if (jobCount === 0) {
                                    alert("No jobs in this time group to update.");
                                    return;
                                }

                                // Ensure we have a valid Date object
                                var dateForProcessing;
                                if (newDateValue instanceof Date) {
                                    dateForProcessing = newDateValue;
                                } else if (typeof newDateValue === 'string') {
                                    dateForProcessing = new Date(newDateValue);
                                } else {
                                    alert("Invalid date selected. Please try again.");
                                    return;
                                }

                                // Validate the date
                                if (isNaN(dateForProcessing.getTime())) {
                                    alert("Invalid date selected. Please try again.");
                                    return;
                                }

                                // Convert to API format (YYYY-MM-DD)
                                var dateForApi = moment(dateForProcessing).format("YYYY-MM-DD");

                                // Confirm the bulk update
                                var confirmMessage = "Are you sure you want to update the delivery date for all " +
                                    jobCount + " jobs in time group '" + groupName + "' to " +
                                    moment(dateForProcessing).format("DD/MM/YYYY") + "?";

                                if (confirm(confirmMessage)) {
                                    $scope.bulkUpdateGroupRouteDate(jobs, groupName + " Time Group", dateForApi);
                                }
                            },
                            submitValue: "Update Date"
                        };
                        $scope.gather.showForm();
                    },
                    // Only show for time groups that have jobs
                    enabled: function ($itemScope, $event, modelValue, text, $li) {
                        return $itemScope.grouped.jobs && $itemScope.grouped.jobs.length > 0;
                    }
                },
                // Existing: Open these times
                {
                    text: 'Open these times',
                    click: function ($itemScope, $event, modelValue, text, $li) {
                        $scope.setTime();
                    }
                }
            ];


            //Select Job
            $scope.selectJob = function (job, clear) {

                setTimeout(function () {

                    $scope.currentJob = job;
                    $scope.$apply();

                    var run = $scope.runList.find(obj => {
                        return obj.jobs.find(j => {
                            return j.JobNumber === job.JobNumber;
                        });
                    });

                    if (run !== undefined) {
                        $("#runList").find(".active").removeClass("active");

                        var goTop = $("#runList").find("[data-runname='" + run.name + "']").offset().top;
                        var $parentDiv = $("#runList").find("[data-runname='" + run.name + "']").parents(".box-content");

                        try {
                            goTop = goTop - $parentDiv.offset().top + $parentDiv.scrollTop() - 31;
                            $parentDiv.scrollTop(goTop);
                        } catch (e) {
                            //ignore
                        }
                        $("#runList").find("[data-runname='" + run.name + "']").addClass("active").trigger('click');
                        window.setTimeout(function () {
                            $scope.currentSelection = " for Job " + job.JobNumber;
                            highlightPin($scope.currentJob);
                            $scope.selectJobFromMap(job.toLat, job.toLng);
                        }, 700);
                        return;
                    }

                    if (clear == true) {
                        $scope.jobGroups = false;
                        $scope.jobsCurrentList = false;
                        $scope.potentialCouriersSelection = (" for Job " + job.JobNumber);
                        $scope.groupJobsSelection = (" for Job " + job.JobNumber);
                        $scope.currentWorkSelection = "";
                    }
                    $scope.currentCourier = null;
                    $scope.currentSelection = " for Job " + job.JobNumber;
                    highlightPin($scope.currentJob);
                }, 0);
            };
        };

        $scope.getData();


        /////////////////////////
        // JOB DETAILS
        /////////////////////////


        $scope.detailAddressMenu = [
            // NEW IMPLEMENTATION
            {
                text: 'Update GPS',
                click: function ($itemScope, $event, modelValue, text, $li) {
                    //$scope.selected = $itemScope.item.name;

                    $scope.updateGPS($event.currentTarget.attributes['data-field'].nodeValue);

                }
            }
        ];

        //////////////////////////
        // GPS form
        //////////////////////////
        $scope.updateGPS = function (field) {
            var suburb = "";
            if (field == "ToAddress") {
                if ($scope.currentJob.toLat) {
                    var postCode = $scope.currentJob.ToPostCode;
                    var lat = $scope.currentJob.toLat;
                    var long = $scope.currentJob.toLng;
                    var q = $("#gpsMap").attr("data-src") + lat + "," + long;
                    suburb = $scope.currentJob.ToSuburb;
                } else {
                    var lat = "";
                    var long = "";
                    var q = $("#gpsMap").attr("data-src") + encodeURIComponent($scope.currentJob[field]);
                }
            } else {
                if ($scope.currentJob.fromLat) {
                    var postCode = $scope.currentJob.FromPostCode;
                    var lat = $scope.currentJob.fromLat;
                    var long = $scope.currentJob.fromLng;
                    var q = $("#gpsMap").attr("data-src") + lat + "," + long;
                    suburb = $scope.currentJob.FromSuburb;
                } else {
                    var lat = "";
                    var long = "";
                    var q = $("#gpsMap").attr("data-src") + encodeURIComponent($scope.currentJob[field]);
                }
            }

            $("#gpsMap").attr("src", q);

            $scope.gpsForm = {
                "data": {
                    "address": $scope.currentJob[field] + ", " + suburb,
                    "lat": lat,
                    "long": long,
                    "postCode": postCode

                },
                "country": (typeof IsUsTenant !== 'undefined' && IsUsTenant === 'True') ? 'us' : 'nz',
                validateLatLng: function () {
                    if (!$scope.gpsUpdateForm) return;

                    var lat = $scope.gpsForm.data.lat;
                    var lng = $scope.gpsForm.data.long;

                    // Validate latitude range (-90 to 90)
                    if (lat !== "" && lat !== null && lat !== undefined) {
                        var latNum = parseFloat(lat);
                        if (isNaN(latNum) || latNum < -90 || latNum > 90) {
                            $scope.gpsUpdateForm.latitude.$setValidity('range', false);
                        } else {
                            $scope.gpsUpdateForm.latitude.$setValidity('range', true);
                        }
                    } else {
                        $scope.gpsUpdateForm.latitude.$setValidity('range', true);
                    }

                    // Validate longitude range (-180 to 180)
                    if (lng !== "" && lng !== null && lng !== undefined) {
                        var lngNum = parseFloat(lng);
                        if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
                            $scope.gpsUpdateForm.longitude.$setValidity('range', false);
                        } else {
                            $scope.gpsUpdateForm.longitude.$setValidity('range', true);
                        }
                    } else {
                        $scope.gpsUpdateForm.longitude.$setValidity('range', true);
                    }
                },
                submit: function (response) {
                    var location;
                    var postCode = null;
                    // Custom GPS Location
                    if (!response) {
                        // Validate lat/lng format before creating location
                        var lat = $scope.gpsForm.data.lat;
                        var lng = $scope.gpsForm.data.long;

                        if (!lat || !lng || lat === "" || lng === "") {
                            alert("Please enter valid latitude and longitude values.");
                            return;
                        }

                        var latNum = parseFloat(lat);
                        var lngNum = parseFloat(lng);

                        if (isNaN(latNum) || isNaN(lngNum)) {
                            alert("Invalid latitude or longitude format. Please enter decimal numbers.");
                            return;
                        }

                        if (latNum < -90 || latNum > 90) {
                            alert("Latitude must be between -90 and 90 degrees.");
                            return;
                        }

                        if (lngNum < -180 || lngNum > 180) {
                            alert("Longitude must be between -180 and 180 degrees.");
                            return;
                        }

                        location = new google.maps.LatLng(latNum, lngNum);
                        postCode = $scope.gpsForm.data.postCode;
                    } else {
                        location = response.geometry.location;

                        if (response.address_components.find(x => x.types[0] == "postal_code")) {
                            postCode = response.address_components.find(x => x.types[0] == "postal_code").long_name;
                        }
                    }

                    //var callData = {
                    //    "address": field,
                    //    "lat": location.lat(),
                    //    "lng": location.lng(),
                    //    "postCode": postCode,
                    //    "jobID": $scope.currentJob.BulkJobID
                    //}

                    var path = "/Job/UpdateGPS";
                    uRunData.doAPI(path, {
                        JobId: $scope.currentJob.BulkJobID,
                        Address: field,
                        Lat: location.lat().toString(),
                        Lng: location.lng().toString(),
                        PostCode: postCode
                        }).then(function (data) {
                        if (data.response == "Success") {
                            if (field == "ToAddress") {
                                $scope.currentJob.toLat = location.lat();
                                $scope.currentJob.toLng = location.lng();
                                $scope.currentJob.ToPostCode = postCode;
                            } else {
                                $scope.currentJob.fromLat = location.lat();
                                $scope.currentJob.fromLng = location.lng();
                                $scope.currentJob.FromPostCode = postCode;
                            }
                            alert("GPS updated successfully!");
                        } else {
                            alert(data.response);
                        }

                        // Hide the GPS update form
                        $(".gpsForm").hide(0);
                        // Hide the Update address form and return to the Detail section
                        $scope.gather.cancel();

                        setTimeout(function () {
                            $scope.$apply();
                        }, 0);

                    });
                },
                cancel: function () {
                    $(".gpsForm").hide(0);
                },
                placeChanged: function (place) {
                    if (place != null) {
                        $scope.place = place;
                    } else {
                        $scope.place = this.getPlace();
                    }

                    $scope.gpsForm.search = $scope.place.formatted_address;
                    $scope.gpsForm.data.lat = $scope.place.geometry.location.lat();
                    $scope.gpsForm.data.long = $scope.place.geometry.location.lng();
                    if ($scope.place.address_components.find(x => x.types[0] == "postal_code")) {
                        $scope.gpsForm.data.postCode = $scope.place.address_components
                            .find(x => x.types[0] == "postal_code").long_name;
                    }
                    if ($scope.map && $scope.place.geometry && $scope.place.geometry.location) {
                        $scope.map.setCenter($scope.place.geometry.location);
                    }

                },
                moveMarker: function (event) {
                    var latlng = event.latLng;
                    GeoCoder.geocode({ location: latlng })
                        .then(function (result) {
                            $scope.marker.setPosition(latlng);
                            $scope.gpsForm.placeChanged(result[0]);
                        });
                },
                markerDragend: function (event) {
                    //GeoCoder.geocode({ location: $scope.marker.getPosition() })
                    //    .then(function (result) {
                    //        $scope.gpsForm.placeChanged(result[0]);
                    //    });

                    //Geo coder for drag marker
                    var position = event.latLng;
                    if (!position) {
                        console.warn('No position data available from marker drag event');
                        return;
                    }

                    GeoCoder.geocode({ location: position })
                        .then(function (result) {
                            if (result && result.length > 0) {
                                $scope.gpsForm.placeChanged(result[0]);
                            }
                        })
                        .catch(function (error) {
                            console.error('Geocoding failed:', error);
                        });
                }
            }

            $(".gpsForm").show(0);

            $scope.$watch('gpsForm.details', function (newValue, oldValue, scope) {
                setTimeout(function () {
                    if ($scope.gpsForm.search) {

                        $("#gpsMap").attr("src", $("#gpsMap").attr("data-src") + encodeURIComponent($scope.gpsForm.search));
                        if ($scope.gpsForm.details.geometry.location) {
                            $scope.gpsForm.data.lat = $scope.gpsForm.details.geometry.location.lat();
                            $scope.gpsForm.data.long = $scope.gpsForm.details.geometry.location.lng();
                            if ($scope.gpsForm.details.address_components.find(x => x.types[0] === "postal_code")) {
                                $scope.gpsForm.data.postCode = $scope.gpsForm.details.address_components
                                    .find(x => x.types[0] === "postal_code").long_name;
                            }
                        }

                    } else {
                        if (!$scope.gpsForm.data.long) {
                            $("#gpsMap").attr("src", $("#gpsMap").attr("data-src") + "Auckland");
                        }
                    }
                }, 1000);
            });

            $scope.copyGpsAddress = function () {
                //Trim to street address only
                $scope.gpsForm.search = $scope.gpsForm.data.address.split(",")[1].trim();
                //$scope.gpsForm.search = angular.copy($scope.gpsForm.data.address);
                $("#gpsSearch").focus();
            }
        };

        $scope.editDetailField = function (fieldName, label, value, jobID, type, options) {

            console.log("Editing field:", fieldName, "with value:", value, "type:", type);

            var processedValue = value;

            try {
                if (type === "date") {
                    // Handle date conversion properly
                    if (typeof value === 'string') {
                        // Handle various date formats
                        var formats = ['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'];
                        var parsed = null;

                        for (var i = 0; i < formats.length; i++) {
                            parsed = moment(value, formats[i], true);
                            if (parsed.isValid()) break;
                        }

                        if (!parsed || !parsed.isValid()) {
                            // Try automatic parsing as last resort
                            parsed = moment(value);
                        }

                        if (parsed && parsed.isValid()) {
                            processedValue = parsed.toDate();
                        } else {
                            console.warn("Could not parse date:", value, "using today's date");
                            processedValue = new Date();
                        }
                    } else if (value instanceof Date) {
                        processedValue = value;
                    } else {
                        console.warn("Invalid date value:", value, "using today's date");
                        processedValue = new Date();
                    }
                }

                if (type === "time") {
                    if (typeof value === 'string') {
                        // Parse various time formats
                        var timeFormats = ['HH:mm:ss', 'HH:mm', 'h:mm a', 'h:mm:ss a'];
                        var timeParsed = moment(value, timeFormats, true);

                        if (timeParsed.isValid()) {
                            processedValue = timeParsed.toDate();
                        } else {
                            console.warn("Could not parse time:", value, "using current time");
                            processedValue = new Date();
                        }
                    } else if (!(value instanceof Date)) {
                        console.warn("Invalid time value:", value, "using current time");
                        processedValue = new Date();
                    }
                }
            } catch (error) {
                console.error("Error processing field value:", error);
                processedValue = type === "date" || type === "time" ? new Date() : value;
            }

            $scope.gather.form = {
                id: "editField",
                title: "Edit " + label,
                fields: [
                    {
                        "name": fieldName,
                        "label": label + "...",
                        "value": processedValue,
                        "jobID": jobID,
                        "type": type,
                        "options": options,
                        "originalValue": value // Store original for debugging
                    }
                ],
                onSubmit: function () {
                    var fieldValue = $scope.gather.form.fields[0].value;
                    var finalValue = fieldValue;

                    try {
                        // Convert Date objects back to the format expected by the API
                        if (type === "date" && fieldValue instanceof Date) {
                            // Convert to DD/MM/YYYY format for the API
                            finalValue = moment(fieldValue).format("DD/MM/YYYY");
                        } else if (type === "time" && fieldValue instanceof Date) {
                            // Convert to HH:mm:ss format for the API
                            finalValue = moment(fieldValue).format("HH:mm:ss");
                        }

                        console.log("Submitting field update:", {
                            field: fieldName,
                            originalValue: $scope.gather.form.fields[0].originalValue,
                            processedValue: fieldValue,
                            finalValue: finalValue,
                            jobID: $scope.gather.form.fields[0].jobID
                        });

                        $scope.updateDetailField($scope.gather.form.fields[0].name, finalValue, $scope.gather.form.fields[0].jobID);

                    } catch (error) {
                        console.error("Error preparing field value for submission:", error);
                        alert("Error preparing the value for update. Please try again.");
                    }
                },
                submitValue: "Update Field"
            }
            $scope.gather.showForm();
        };

        $scope.updateDetailField = function (field, value, jobID) {

            var callData = {
                "jobID": jobID,
                "field": field,
                "value": value
            };

            console.log("Sending update request:", callData);

            // Show loading indicator for the detail section
            $("#box-jobDetail .loading").show();

            uRunData.doAPI("Job/UpdateJobDetail", JSON.stringify(callData)).then(function (data) {

                $("#box-jobDetail .loading").fadeOut();

                if (data.response === "Success") {

                    var vmFields = field;
                    if (field === "BookDate") vmFields = "DeliveryDate";
                    if (field === "BookTime") vmFields = "ReadyTime";
                    if (field === "ToCompany") vmFields = "CompanyName";
                    if (field === "Qty") vmFields = "Items";
                    if (field === "ProofOfDeliveryMobile") vmFields = "Mobile";
                    if (field === "ProofOfDeliveryEmail") vmFields = "Email";
                    if (field === "Speed") vmFields = "SpeedID";

                    // Update the current job with the value in the correct format
                    $scope.currentJob[vmFields] = value;

                    console.log("Successfully updated", vmFields, "to", value);

                    // Check if this is a date or time field that might affect grouping/sorting
                    var shouldRefreshAll = (field === "BookDate" || field === "BookTime" || field === "Speed");

                    if (shouldRefreshAll) {
                        // For date/time changes, do a complete refresh as it affects grouping
                        console.log("Date/Time field updated, performing complete data refresh");

                        // Store the current job selection to restore after refresh
                        var currentJobNumber = $scope.currentJob ? $scope.currentJob.JobNumber : null;

                        // Perform complete refresh
                        $scope.getData(1);

                        // After a brief delay, try to restore the job selection
                        if (currentJobNumber) {
                            setTimeout(function () {
                                // Find and select the updated job
                                var updatedJob = null;

                                // Search in runJobsAll first
                                if ($scope.runJobsAll) {
                                    updatedJob = $scope.runJobsAll.find(function (job) {
                                        return job.JobNumber === currentJobNumber;
                                    });
                                }

                                if (updatedJob) {
                                    $scope.selectJob(updatedJob, true);
                                    console.log("Restored job selection after refresh:", currentJobNumber);
                                }
                            }, 2000); // Wait 2 seconds for data to load
                        }
                    } else {
                        // For other fields, just update across all lists without full refresh
                        $scope.updateJobInAllLists(jobID, vmFields, value);
                    }

                } else {
                    alert(data.response);
                }

            }).catch(function (error) {
                $("#box-jobDetail .loading").fadeOut();
                console.error("Error updating job detail:", error);
                alert("An error occurred while updating the job. Please try again.");
            });
        };

        // Helper function to update the job in all data structures
        $scope.updateJobInAllLists = function (jobID, fieldName, value) {
            try {
                // Update in runJobsAll
                if ($scope.runJobsAll) {
                    var jobInAll = $scope.runJobsAll.find(function (job) { return job.BulkJobID === jobID; });
                    if (jobInAll) {
                        jobInAll[fieldName] = value;
                    }
                }

                // Update in jobList
                if ($scope.jobList) {
                    var jobInList = $scope.jobList.find(function (job) { return job.BulkJobID === jobID; });
                    if (jobInList) {
                        jobInList[fieldName] = value;
                    }
                }

                // Update in groupedJobs
                if ($scope.groupedJobs) {
                    $scope.groupedJobs.forEach(function (group) {
                        if (group.jobs) {
                            var jobInGroup = group.jobs.find(function (job) { return job.BulkJobID === jobID; });
                            if (jobInGroup) {
                                jobInGroup[fieldName] = value;
                            }
                        }
                    });
                }

                // Update in runList and runBuilder
                if ($scope.runList) {
                    $scope.runList.forEach(function (run) {
                        if (run.jobs) {
                            var jobInRun = run.jobs.find(function (job) { return job.BulkJobID === jobID; });
                            if (jobInRun) {
                                jobInRun[fieldName] = value;
                            }
                        }
                    });
                }

                // Update in runBuilder if it exists
                if ($scope.runBuilder) {
                    var jobInBuilder = $scope.runBuilder.find(function (job) { return job.BulkJobID === jobID; });
                    if (jobInBuilder) {
                        jobInBuilder[fieldName] = value;
                    }
                }

                // Apply the changes
                $scope.$apply();

            } catch (error) {
                console.error("Error updating job in all lists:", error);
            }
        };

        $scope.formatDateForDisplay = function (dateValue) {
            if (!dateValue) return '';

            // If it's already in DD/MM/YYYY format, return as is
            if (typeof dateValue === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(dateValue)) {
                return dateValue;
            }

            // If it's an ISO string or other format, convert to DD/MM/YYYY
            var parsed = moment(dateValue);
            if (parsed.isValid()) {
                return parsed.format("DD/MM/YYYY");
            }

            return dateValue; // Return original if parsing fails
        };

        $scope.formatTimeForDisplay = function (timeValue) {
            if (!timeValue) return '';

            // If it's already in HH:mm:ss format, return as is
            if (typeof timeValue === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(timeValue)) {
                return timeValue;
            }

            // If it's in HH:mm format, return as is (common for time display)
            if (typeof timeValue === 'string' && /^\d{2}:\d{2}$/.test(timeValue)) {
                return timeValue;
            }

            // Handle time parsing for various formats
            var parsed = moment(timeValue, ['HH:mm:ss', 'HH:mm', 'h:mm a', 'h:mm:ss a'], true);
            if (parsed.isValid()) {
                return parsed.format("HH:mm");
            }

            return timeValue; // Return original if parsing fails
        };

        /// RUN Route ///
        $scope.callRouteSavvy = function (locationArray) {
            var locations = [];

            for (var i = 0; i < locationArray.length; i++) {
                //console.log(checkboxArray);
                var adresanesto = locationArray[i];
                if (adresanesto !== "") {
                    locations.push({
                        Name: i,
                        Latitude: locationArray[i].lat,
                        Longitude: locationArray[i].lng,
                        VisitDurationInMinutes: 2
                    });
                }
            }

            var requestData = JSON.stringify(locations);
            uRunData.getRouteSavvy(requestData).then(function (data) {
                drawDirectionsMoreThan23Waypoints(data.routes);
            });
        };

        //// Insert or update run deatil
        //$scope.InsertOrUpdateRun = function(runObj) {
        //    var RunID = null;
        //    var urlPath = "Job/InsertOrUpdateRun";
        //    //DO THE API CALL
        //    uRunData.doAPI(urlPath, JSON.stringify(runObj)).then(function(data) {
        //            if (data.response.Result == "Success") {
        //                RunID = data.response.message;
        //            }

        //            return RunID;
        //    });
        //}
    }]);

// Convert Degress to Radians
function Deg2Rad(deg) {
    return deg * Math.PI / 180;
}


// Get Distance between two lat/lng points using the Haversine function
// First published by Roger Sinnott in Sky & Telescope magazine in 1984 (�Virtues of the Haversine�)
//
function Haversine(lat1, lon1, lat2, lon2) {
    var R = 6372.8; // Earth Radius in Kilometers

    var dLat = Deg2Rad(lat2 - lat1);
    var dLon = Deg2Rad(lon2 - lon1);

    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(Deg2Rad(lat1)) * Math.cos(Deg2Rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c;

    // Return Distance in Kilometers
    return d;
}


function PythagorasEquirectangular(lat1, lon1, lat2, lon2) {
    lat1 = Deg2Rad(lat1);
    lat2 = Deg2Rad(lat2);
    lon1 = Deg2Rad(lon1);
    lon2 = Deg2Rad(lon2);
    var R = 6371; // km
    var x = (lon2 - lon1) * Math.cos((lat1 + lat2) / 2);
    var y = (lat2 - lat1);
    var d = Math.sqrt(x * x + y * y) * R;
    return d;
}

function closestLocation(latitude, longitude, locations) {
    var mindif = 99999;
    var closest;

    //for (index = 0; index < locations.length; ++index) {
    for (var i = 0; i < locations.length; i++) {
        // get the distance between user's location and this point
        //var dif = Haversine( locations[i][1], locations[i][2], latitude, longitude);
        var dif = Haversine(
            parseFloat(locations[i][1].toString().substr(0, 9)),
            parseFloat(locations[i][2].toString().substr(0, 9)),
            parseFloat(latitude.toString().substr(0, 9)),
            parseFloat(longitude.toString().substr(0, 9))
        );
        //var dif = PythagorasEquirectangular(latitude, longitude, locations[index][1], locations[index][2]);

        if (dif < mindif) {
            closest = i;
            mindif = dif;
        }
    }

    // return the nearest location
    var closestLocation = (locations[closest]);
    return closestLocation;
}

/**
 * Returns an array with arrays of the given size.
 *
 * @param myArray {Array} Array to split
 * @param chunkSize {Integer} Size of every group
 */
function chunkArray(myArray, chunkSize) {
    var results = [];

    while (myArray.length) {
        results.push(myArray.splice(0, chunkSize));
    }

    return results;
}

