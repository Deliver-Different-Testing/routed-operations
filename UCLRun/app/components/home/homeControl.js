angular
    .module('uRuns')
    .controller('HomeControl', ['$scope', 'uRunData', "$state", "$filter", '$parse', "hotkeys", 'NgMap','GeoCoder', '$timeout', '$q', function ($scope, uRunData, $state, $filter, $parse, hotkeys, NgMap, GeoCoder, $timeout, $q) {

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
                    setTimeout(function () { $(".gatherForm .focusMe").focus(); }, 100);
                });
            },
            submitValue: "Save"
        }

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
        }


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
                        "label": "PostCode",
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
                        "label": "PostCode",
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
            "map": {
                "title": "Google Map",
                "tpl": "app/components/home/tpls/map.tpl",
                "showSearch": 0
            }
            //  "map": {
            //    "title": "Here Map",
            //    "tpl": "app/components/home/tpls/HereMap.tpl",
            //    "showSearch": 0
            //}
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
        }

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

                        console.log(data);

                        if (data.response == "Success") {

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
            }

            $scope.gather.showForm();

        }

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

        }


        //Column Sorting
        $scope.sort = [];
        $scope.orderList = function (list, prop) {


            if ($scope.sort[list] != prop) {
                $scope.sort[list] = prop;
                $scope[list] = $filter('orderBy')($scope[list], prop);
            } else {
                $scope.sort[list] = "d-" + prop;
                $scope[list] = $filter('orderBy')($scope[list], "-" + prop);
            }

            if (list == "runbuilder") {
                $filter('filter')($scope.runList, { 'isActive': 1 })[0].jobs = $scope.runBuilder;
            }

        }

        $scope.pickDateService = {
            "clients": [],
            "region": [],
            "service": [],
            "status": [],
            "settings": {
                "enableSearch": true,
                "selectedToTop": true
            },
            "date": moment().format("YYYY-MM-DD")
        };

        $scope.doPickDateService = function () {
            //console.log("bro");
            //console.log($scope.pickDateService);
            $scope.dateService = 0;
            $scope.getData(1);
        }

        $scope.openPickDateService = function () {
            $scope.dateService = 1;
            //console.log("happening");
        }

        uRunData.getDateService().then(function (data) {
            //    $scope.pickServices = data.services;
            //    $scope.pickRegions = data.regions;
            //    $scope.pickStatuses = data.statuses;
            $scope.pickClients = data.response.clients;
        });


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
            }
            $scope.gather.showForm();

        }

        ////////////////////////////////////////
        // DISPATCH THE JOBS
        ///////////////////////////////////////
        $scope.dispatchJobs = function (courier) {

            var callData = {
                "call": "dispatchJobs",
                "courier": courier,
                "jobs": []
            }

            $(".activeTable .active").each(function () {
                callData.jobs.push($(this).attr("data-jobid"));
            });

            //DO THE API CALL
            uRunData.doAPI(callData).then(function (data) {

                console.log(data);



                if (data.response == "Success") {

                    var list = $(".activeTable").attr("id");

                    setTimeout(function () {

                        $(".activeTable .active").each(function () {

                            //$(this).hide();
                            $(this).find(".selectjob").click();

                            var index = $scope[list].indexOf($scope.jobToRunBuilder);
                            console.log(index);
                            $scope[list].splice(index, 1);
                            $scope.$apply();

                        });



                    }, 0);

                    if ($(".activeTable").attr("data-group") == "jobsGrouped") {


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

        }



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
        }

        $scope.showCouriers = function (fleet) {

            $("#box-potentialCouriers .loading").show();
            $scope.potentialCouriers = fleet.couriers;
            setTimeout(function () { sizeHeadings($("#potentialCouriers").parents(".column")); }, 1000);
            $("#box-potentialCouriers .loading").fadeOut();

        }

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

        }




        $scope.updateRun = function () {
            $scope.defaultRun = [];
            $scope.defaultRunStart = null;
            $scope.defaultRunEnd = null;
            $scope.defaultRouteResponse = null;

            //Refresh the run list 
            $filter('filter')($scope.runList, { 'isActive': 1 })[0].jobs = $scope.runBuilder;

            //// Get default route response from the saved data
            //if ($filter('filter')($scope.runList, { 'isActive': 1 })) {
            //    //console.log($filter('filter')($scope.runList, {'isActive':1})[0]);
            //    if ($filter('filter')($scope.runList, { 'isActive': 1 })[0] && $filter('filter')($scope.runList, { 'isActive': 1 })[0].RunChanged == false) {
            //        $scope.defaultRouteResponse = $filter('filter')($scope.runList, { 'isActive': 1 })[0].GoogleRouteResponse;
            //        $scope.updatePotentialJobs();
            //        return;
            //    }
            //}

            angular.forEach($scope.runBuilder, function (value, key) {

                //URGENT HQ, change start from the first Pickup from address
                //$scope.defaultRunStart = {lat: -36.9227077, lng: 174.81272650000005}

                // Use the first from lat and lng
                if (key == 0) {
                    $scope.defaultRunStart = { lat: value.fromLat, lng: value.fromLng };
                }

                if (value.isEnd == 1) {

                    $scope.defaultRunEnd = { lat: value.toLat, lng: value.toLng };

                } else if (value.toLat && value.toLng) {
                    $scope.defaultRun.push({ lat: value.toLat, lng: value.toLng });
                }

            });


            if ($scope.defaultRunEnd == null) {
                $scope.defaultRunEnd = angular.copy($scope.defaultRun[$scope.defaultRun.length - 1]);
                $scope.defaultRun.splice($scope.defaultRun.length - 1, 1);
            }

            //if ($scope.defaultRun.length > 0) {
            //	calcRoute();
            //}

            $scope.updatePotentialJobs();
        };


        $scope.addToRunFromMap = function (lat, lng, jn) {

            $scope.runBuilder.push($filter('filter')($scope.jobList, { 'JobNumber': jn })[0]);

            $filter('filter')($scope.runJobsAll, { 'JobNumber': jn })[0].inBuilder = 1;
            $filter('filter')($scope.jobList, { 'JobNumber': jn })[0].inBuilder = 1;
            $filter('filter')($scope.runBuilder, { 'JobNumber': jn })[0].inBuilder = 1;

            $scope.updateRun();

        }


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


        $scope.removeJobFromMap = function (lat, lng) {

            var toCompare = [];

            angular.forEach($scope.runBuilder, function (job, key) {
                toCompare.push([key, job.toLat, job.toLng]);
            });

            var closestIndex = closestLocation(lat, lng, toCompare);

            var closestJob = $scope.runBuilder[closestIndex[0]];

            $scope.deleteFromRun(closestJob, 1);



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
            $scope.updateRun();

        }



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

        }



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
            }

        ];

        $scope.deleteFromRun = function (job, fromBuilder) {

            $filter('filter')($scope.runJobsAll, { 'JobNumber': job.JobNumber },true)[0].inBuilder = 0;

            if (fromBuilder == 1) {

                var index = $scope.runBuilder.indexOf(job);
                $scope.runBuilder.splice(index, 1);


                $scope.updateRun();
            }

        }



        $scope.addToRunBuilder = function (job) {

            var list = $(".activeTable").attr("id");

            $scope.runBuilder.push(angular.copy(job));

            var index = $scope[list].indexOf(job);
            $scope[list][index].inBuilder = 1;

            var index = $scope.runJobsAll.indexOf(job);
            $scope.runJobsAll[index].inBuilder = 1;

        }

        $scope.addGroupToRunBuilder = function (jobs) {

            var list = $(".activeTable").attr("id");

            angular.forEach(jobs, function (job, key) {

                if (job.inBuilder != 1) {

                    $scope.runBuilder.push(angular.copy(job));

                    var index = jobs.indexOf(job);
                    jobs[index].inBuilder = 1;
                    //group.jobs.splice(index, 1);

                    var index = $scope.runJobsAll.indexOf(job);
                    $scope.runJobsAll[index].inBuilder = 1;
                    //$scope.runJobsAll.splice(index, 1);
                }

            });

        }

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
                        $filter('filter')($scope.runJobsAll, j => j.JobNumber == job.JobNumber)[0].inBuilder = 1;
                    }, 0);
                });
            });


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
        }

        //$scope.getPotentialCouriers();

        $scope.sendTo = function (path) {
            $("#box-runList").find(".loading").show();
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

            // copy real job array from runlist
            var buildedRunList = $scope.runList.filter(r => r.jobs.length > 0);
            // Replace Jobs to just what we need
            angular.forEach(buildedRunList, function(run, key) {
                run.jobs = run.jobs.map(x => {
                    return {
                        BulkJobID: x.BulkJobID,
                        BuilderIndex: x.BuilderIndex
                    }
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

                    $("#box-jobsList .loading").fadeOut();

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
            }

            $("#box-jobsList .loading").fadeOut();
        }

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

                        },
                        submitValue: "Save"
                    }

                    $scope.gather.showForm();

                }
            },
            // Edit Name
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
                                "value":  $itemScope.run.name
                            }
                        ],
                        onSubmit: function () {
                            // Get run name merge to
                            setTimeout(function () {
                                var runNameMergeTo = $("#mergeRun").find("input").val();

                                // Get Run merge to
                                //var runMergeTo = $scope.runList.find(x => x.name.toLowerCase() == runNameMergeTo.toLowerCase());
                                if ($filter('filter')($scope.runList, function(i){ return i.name.toLowerCase() == runNameMergeTo.toLowerCase()})[0]) {
                                    
                                    // Found the destination run is in lock mode
                                    if ($filter('filter')($scope.runList, function(i){ return i.name.toLowerCase() == runNameMergeTo.toLowerCase() && i.locked == 1})[0]) {
                                        alert("Error: " + runNameMergeTo + " has been locked, please un-lock the run before the merging");
                                        return false;
                                    }

                                    // Merge current run jobs into the runMergeTo
                                    var runMergeTo = $filter('filter')($scope.runList,
                                        function(i) {
                                            return i.name.toLowerCase() == runNameMergeTo.toLowerCase();
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
                                    //$scope.$apply();
                                } else {
                                    alert("Error: " + runNameMergeTo + " can not be found!");
                                }
                                return false;
                            }, 0);
                        },
                        submitValue: "Save"
                    }

                    $scope.gather.showForm();
                }
            },
            // Routing run
            {
                text: 'Route and Lock Run',
                click: function ($itemScope, $event, modelValue, text, $li) {
                    $scope.showRun($itemScope.run, 1);
                    setTimeout(function () { $scope.activateRunDrop(); $scope.activateRunListDrop(); }, 0);
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

                    $scope.toggleRunLock($itemScope.run);
                }
            },
            // Remove
            {
                text: 'Remove',
                click: function ($itemScope, $event, modelValue, text, $li) {
                    setTimeout(function () {

                        console.log($itemScope);
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

                        $scope.$apply();

                    }, 0);

                }
            }
        ];

        // Lock run
        $scope.toggleRunLock = function(run) {
            if (run.locked != 1) {
                // Check all jobs get RunOrders before lock the run
                var unRoutJobs = run.jobs.filter(j => j.BuilderIndex == null || j.BuilderIndex == "undefined");
                if (unRoutJobs.length > 0) {
                    if (!confirm('Are you sure you want to lock this un-route run into the database?')) {
                        return false;
                    }
                    //alert("Please route the run before we can lock it.");
                    //return false;
                }

                // Insert/Update run detail into database
                //  Store ID back into run  
                uRunData.doAPI("Job/InsertOrUpdateRun", JSON.stringify(run)).then(function (data) {
                    if (data.response.Result == "Success") {
                        run.ID = parseInt(data.response.Message);
                    } else {
                        if (data.response.Message) {
                            alert(data.response.Result + ": " +  data.response.Message);
                        } else {
                            alert(data.response);  
                        }
                               
                        return false;
                    }

                    run.locked = 1;
                    $scope.showRun(run);
                });
            } else {
                //  Store ID back into run  
                uRunData.doAPI("Job/DeleteRun", JSON.stringify(run)).then(function (data) {
                    if (data.response == "Success") {
                        run.ID = null;
                    } else {
                        alert(data.response);
                        return false;
                    }
                });

                run.locked = 0;
                $scope.showRun(run);

                setTimeout(function () { $scope.activateRunDrop(); $scope.activateRunListDrop(); }, 0);
            }
        }

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


                                if ($(this).attr("data-isGroup") == 1) {

                                    var jobs = $(this).scope().grouped.jobs;

                                    angular.forEach(jobs, function (job, key) {
                                        if (job.inBuilder != 1) {
                                            job.inBuilder = 1;
                                            run.jobs.push(job);
                                        }
                                    });

                                } else if ($(this).attr("data-isCourier") == 1) {

                                    run.courier = $(this).scope().courier;
                                    $scope.$apply();

                                } else {

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

        }


        setTimeout(function () {
            $scope.activateRunListDrop();
        }, 1000);

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
        }

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
        }

        $scope.runBuilderTotals = function () {
            $scope.calc = {};
            if ($scope.runBuilder) {
                if ($scope.runBuilder.length > 0 && $filter('filter')($scope.runList, { 'isActive': 1 })) {
                    if ($filter('filter')($scope.runList, { 'isActive': 1 }).length > 0) {

                        var hourlyRate = 25;
                        var expPerKm = 2;

                        $scope.calc.totalMins = $filter('filter')($scope.runList, { 'isActive': 1 })[0].mins;
                        $scope.calc.totalKms = $filter('filter')($scope.runList, { 'isActive': 1 })[0].kms;

                        $scope.calc.timeAsHourPercent = Math.round($scope.calc.totalMins / 60 * 100) / 100;
                        $scope.calc.totalDrops = $filter('filter')($scope.runList, { 'isActive': 1 })[0].jobs.length;
                        $scope.calc.petrolExpense = $scope.calc.totalDrops * expPerKm;

                        $scope.calc.totalPayout = Math.round(hourlyRate * $scope.calc.timeAsHourPercent * 100) / 100;

                        //Revenue 

                        $scope.calc.revenue = 0;
                        angular.forEach($scope.runBuilder, function (value, key) {
                            $scope.calc.revenue += parseInt(value.Amount);
                        });


                        $scope.calc.courierPercent = (Math.round(($scope.calc.totalPayout / $scope.calc.revenue * 100) * 100) / 100);

                        if ($scope.calc.courierPercent > 75) {
                            $scope.calc.courierPercentColour = "red";
                        } else if ($scope.calc.courierPercent > 65) {
                            $scope.calc.courierPercentColour = "orange";
                        } else {
                            $scope.calc.courierPercentColour = "green";
                        }

                        $scope.calc.courierPercent = $scope.calc.courierPercent + "%";

                        $filter('filter')($scope.runList, { 'isActive': 1 })[0].courierPercent = angular.copy($scope.calc.courierPercent);
                    }

                }
            } else {
                return " ";
            }

        }

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

        $scope.updateRunDetails = function (mins, kms, drops, order, googleRouteResponse) {
            if ($filter('filter')($scope.runList, { 'isActive': 1 })) {
                //console.log($filter('filter')($scope.runList, {'isActive':1})[0]);
                if ($filter('filter')($scope.runList, { 'isActive': 1 })[0]) {
                    var dropExtra = 4 * drops;
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
        }

        $scope.showRun = function (run, manualRoute) {

            $scope.runBuilder = run.jobs;
            // Filter run jobs by the run order
            $scope.runBuilder = $filter('orderBy')($scope.runBuilder, "BuilderIndex");

            $scope.activeRunName = run.name;

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

            if (!localStorage.getItem('runList')) {
                $scope.updatePotentialJobs(manualRoute);
            }

        }

        ////////////////////////////////////////////////////////////////////////////////////////////////////////////////

        $scope.potentialJobs = [];

        $scope.showJobs = function (group) {

            $("#box-jobsList").find(".loading").show();
            $scope.jobList = group.jobs;
            setTimeout(function () { sizeHeadings($("#jobList").parents(".column")); }, 1000);
            $("#box-jobsList .loading").fadeOut();

            $scope.updatePotentialJobs();

        }

        $scope.updatePotentialJobs = function (manualRoute) {

            $scope.potentialJobs = [];

            angular.forEach($scope.jobList, function (value, key) {
                if (value.inBuilder != 1 && value.toLat) {
                    $scope.potentialJobs.push({ "lat": value.toLat, "lng": value.toLng, "jn": value.JobNumber });
                }
            });

            setTimeout(function () {
                var onlyDrawMarks = true;
                if ($scope.routeSetting.autoRoute || manualRoute == true) {
                    onlyDrawMarks = false;
                }

                calcRoute(onlyDrawMarks);
            }, 0);
        }

        $scope.getData = function (clearStorage) {


            if (clearStorage == 1) {
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
            $scope.jobsCurrentList = false;
            $scope.currentCourier = false;
            $scope.runNameGroups = [];
            $scope.runNameJobsGroups = [];
            $scope.runJobsAllByPostalCodeRunName = [];
            $scope.couriers = [];
            $scope.bulkRuns = {};
            $scope.routeSetting = {
                "autoRoute": false
            }

            $("#box-groupedJobs").find(".loading").show();

            $scope.selectedClients = $scope.pickDateService.clients.map(a => a.id);

            uRunData.getRunJobsAll(moment($scope.pickDateService.date), $scope.selectedClients).then(function (data) {
                $("#box-groupedJobs .loading").fadeOut();
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


                    setTimeout(function () { $("#box-groupedJobs .loading").fadeOut(); }, 100);


                    // Get runs from database
                    uRunData.doGetAPI("Job/GetBulkRuns?datetime=" + moment($scope.pickDateService.date).toISOString() + '&clientIds=' + $scope.selectedClients).then(function (data) {
                        var bulkRuns = data.response;

                        // Group runs by ID
                        var bulkRunGroups = bulkRuns.reduce(function (obj, item) {
                            obj[item.ID] = obj[item.ID] || [];
                            obj[item.ID].push(item);
                            return obj;
                        }, {});
                        // Group run jobs by ID
                        var bulkRunJobsGroups = bulkRuns.reduce(function (obj, item) {
                            obj[item.ID] = obj[item.ID] || [];
                            var job = $filter('filter')($scope.runJobsAll, j => j.BulkJobID == item.BulkJobID)[0];

                            if (job !== undefined) {
                                job.RunOrder = item.RunOrder;
                                obj[item.ID].push(job);
                            }

                            return obj;
                        }, {});
                        // Conbine runs and jobs
                        var bulkRunJobsGroupsArray = Object.keys(bulkRunGroups).map(function (key) {
                            var item = $filter('filter')(bulkRuns, j => j.ID == key)[0];
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
                                jobs: bulkRunJobsGroups[key]
                            };
                        });

                        $scope.bulkRuns = bulkRunJobsGroupsArray;

                        //$scope.buildRunByPostalCode();

                        $scope.sortByTime();

                        $scope.localStorage();
                    });
                });

                //setTimeout(function(){ $("#box-groupedJobs .loading").fadeOut(); }, 100);	
                //$scope.sortByTime();
                //$scope.localStorage();
            });

            $scope.buildRunByPostalCode = function() {

                // Alert if there is any invalid unlocked jobs
                if ($filter('filter')($scope.runJobsAll, j=> j.PrefixRunName === null || j.toLat === null || j.ToPostCode === null).length > 0) {
                    alert("Please fix the invalid jobs before you can build runs");
                    return false;
                }

                // Get all un-locked run jobs with Postal Code
                var unLockedJobs = $filter('filter')($scope.runJobsAll, j => j.PrefixRunName !== null && j.PrefixRunName.trim().length > 0 && j.BulkJobRunID === 0);

                //// Group all jobs by PostalCode
                //$scope.runJobsAllByPostalCode = unLockedJobs.reduce(function (obj, item) {
                //    if (item.ToPostCode !== 0) {
                //        obj[item.ToPostCode] = obj[item.ToPostCode] || [];
                //        obj[item.ToPostCode].push(item);
                //    }
                //    return obj;
                //}, {});

                // Group all jobs by PostalCode
                $scope.runJobsAllByPostalCodeRunName = unLockedJobs.reduce(function (obj, item, index, array) {
                    if (item.ToPostCode !== 0) {
                        obj[item.PrefixRunName] = obj[item.PrefixRunName] || [];
                        obj[item.PrefixRunName].push(item);
                    }
                    return obj;
                }, {});

                //var runNameGroups = $scope.runNameJobs.reduce(function (obj, item) {
                //    obj[item.PrefixRunName] = obj[item.PrefixRunName] || [];
                //    obj[item.PrefixRunName].push(item);
                //    return obj;
                //}, {});   

                $("#box-groupedJobs").find(".loading").show();
                console.log("Build all runs start");

                var promises = [];
                // Filter and map all valid lat lng
                Object.keys($scope.runJobsAllByPostalCodeRunName).forEach(key => {
                    var currentJobs = $scope.runJobsAllByPostalCodeRunName[key];
                    var start = {jobNumber: currentJobs[0].JobNumber,  lat: currentJobs[0].fromLat, lng: currentJobs[0].fromLng}
                    var checkboxArray = currentJobs.map(x=> { return {jobNumber: x.JobNumber, lat:x.toLat, lng: x.toLng}});
                    //Add start point and end point into the routesavvy checkpoints
                    checkboxArray.unshift(start);
                    checkboxArray.push(start);

                    var locations = [];
                    for (var i = 0; i < checkboxArray.length; i++) {
                        if (checkboxArray[i] !== "") {
                            locations.push({
                                Name: key+ "," + checkboxArray[i].jobNumber,
                                Latitude: checkboxArray[i].lat,
                                Longitude: checkboxArray[i].lng,
                                VisitDurationInMinutes: 2
                            });
                        }
                    }

                    var requestData = JSON.stringify(locations);
                    var promise = uRunData.getRouteSavvyWithName(requestData).then(function (data) {
                        if (data.routes.length> 0) {
                            // remove and start and end point routes
                            data.routes.splice(0, 1);
                            data.routes.splice(data.routes.length - 1, 1);

                            var postalCodeKey = data.routes[0].name.split(",")[0];

                            //Insert build index for jobs
                            for (var j = 0; j < data.routes.length; j++) {

                                $scope.runJobsAllByPostalCodeRunName[key].find(x=> x.JobNumber  ==  data.routes[j].name.split(",")[1]).BuilderIndex = j + 1;
                                
                                $scope.runJobsAll.find(x => x.JobNumber ==  data.routes[j].name.split(",")[1]).BuilderIndex = j + 1;
                                $scope.runJobsAll.find(x => x.JobNumber ==  data.routes[j].name.split(",")[1]).inBuilder = 1;
                            }

                            //Devide runNameGroups jobs into 20 by default for each runs
                            $scope.runJobsAllByPostalCodeRunName[key] = $filter('orderBy')(  $scope.runJobsAllByPostalCodeRunName[key], "BuilderIndex");

                            var dividedRunGroups = [];
                            while ($scope.runJobsAllByPostalCodeRunName[key].length) {
                                // Merge the last few jobs into the second last run group
                                if (dividedRunGroups.length &&  $scope.runJobsAllByPostalCodeRunName[key].length && $scope.runJobsAllByPostalCodeRunName[key].length < $scope.runJobsAllByPostalCodeRunName[key][0].MaxJobsPerRun) {
                                    dividedRunGroups[dividedRunGroups.length - 1] = dividedRunGroups[dividedRunGroups.length - 1].concat(
                                        $scope.runJobsAllByPostalCodeRunName[key].splice(0, $scope.runJobsAllByPostalCodeRunName[key][0].MaxJobsPerRun));
                                } else {
                                    dividedRunGroups.push($scope.runJobsAllByPostalCodeRunName[key].splice(0, $scope.runJobsAllByPostalCodeRunName[key][0].MaxJobsPerRun));
                                    }
                                }

                            var labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                            var result = dividedRunGroups.map(function(v,i) {
                                // return  { name: key + "-" + (i+1) , jobs: dividedRunGroups[i]}
                                var runNameSuffix = labels[ i % labels.length];
                                var run = { name: key + "-" + runNameSuffix, jobs: dividedRunGroups[i] };

                                // Auto lock the run
                                $scope.toggleRunLock(run);
                                return run;
                            });

                            // flatten runNameGroupsArrays; 
                            $scope.runNameJobsGroups = [].concat.apply([], result);

                            // Conbine the empty run with the courier groups run
                            $scope.runList.push.apply($scope.runList,  $scope.runNameJobsGroups);
                        }
                    });
                    promises.push(promise);
                });

                // Promsies all done 
                $q.all(promises).then(function() {
                        $("#box-groupedJobs").find(".loading").fadeOut();
                        console.log("Build all runs done");
                    }
                );

            }

            //$scope.buildRunByPostalCode_callBack = function(routes) {
            //    $scope.$apply();
            //}

            $scope.sortByTime = function () {

                var members = $scope.runJobsAll;

                //// Add RunName jobs groups 
                //$scope.runNameJobs = $filter('filter')(members, j => j.RunName != null && j.RunName.trim().length > 0 && j.BulkJobRunID == 0);
                //// Add jobs into courierJobsGroups
                //var runNameGroups = $scope.runNameJobs.reduce(function (obj, item) {
                //    obj[item.RunName] = obj[item.RunName] || [];
                //    obj[item.RunName].push(item);
                //    return obj;
                //}, {});

                //var runNameGroupsArray = Object.keys(runNameGroups).map(function (key) {
                //    return { name: key, jobs: runNameGroups[key] };
                //});

                // Add RunName jobs groups
                $scope.runNameJobs = $filter('filter')(members, j => j.PrefixRunName != null && j.PrefixRunName.trim().length > 0 && j.BulkJobRunID == 0);
                // Add jobs into courierJobsGroups
                var runNameGroups = $scope.runNameJobs.reduce(function (obj, item) {
                    obj[item.PrefixRunName] = obj[item.PrefixRunName] || [];
                    obj[item.PrefixRunName].push(item);
                    return obj;
                }, {});

                //Devide runNameGroups jobs into 20 for each run
                var runNameGroupsArray = Object.keys(runNameGroups).map(function (key) {
                    var dividedRunGroups = [];
                    while (runNameGroups[key].length) {
                        dividedRunGroups.push(runNameGroups[key].splice(0, runNameGroups[key][0].MaxJobsPerRun));
                    }

                    var labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                    var result = dividedRunGroups.map(function (v, i) {
                        // return  { name: key + "-" + (i+1) , jobs: dividedRunGroups[i]}
                        var runNameSuffix = labels[i % labels.length];
                        return { name: key + "-" + runNameSuffix, jobs: dividedRunGroups[i] };
                    });

                    return result;
                });

                // flatten runNameGroupsArrays; 
                $scope.runNameJobsGroups = [].concat.apply([], runNameGroupsArray);

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

            }


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
            }

            $scope.addTime = function (time) {
                $scope.filterTimes.push(time);
            }

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
                // NEW IMPLEMENTATION
                {
                    text: 'Create run from group',
                    click: function ($itemScope, $event, modelValue, text, $li) {
                        $scope.newRun($itemScope.grouped.jobs);
                    }
                }
            ];

            $scope.groupedTimeMenu = [
                // NEW IMPLEMENTATION
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
            }
        }

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
        NgMap.getMap().then(function(map) {
            $scope.map = map;
            $scope.marker = map.markers[0];
        });
       

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
                submit: function (response) {
                    var location;
                    var postCode = null;
                    // Custom GPS Location
                    if (!response) {
                        location = new google.maps.LatLng($scope.gpsForm.data.lat, $scope.gpsForm.data.long);
                        postCode = $scope.gpsForm.data.postCode;
                    } else {
                        location = response.geometry.location;

                        if (response.address_components.find(x => x.types[0] == "postal_code")) {
                            postCode = response.address_components.find(x => x.types[0] == "postal_code").long_name;
                        }
                    }

                    var callData = {
                        "address": field,
                        "lat": location.lat(),
                        "lng": location.lng(),
                        "postCode": postCode,
                        "jobID": $scope.currentJob.BulkJobID
                    }

                    var path = "/Job/UpdateGPS";
                    uRunData.doAPI(path, callData).then(function (data) {
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
                placeChanged:  function(place) {
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
                    $scope.map.setCenter($scope.place.geometry.location);
                },
                moveMarker: function(event) {
                    var latlng = event.latLng;
                    GeoCoder.geocode({location: latlng})  
                        .then(function (result) {
                            $scope.marker.setPosition(latlng);
                        $scope.gpsForm.placeChanged(result[0]);
                    });
                },
                markerDragend: function() {
                    //Geo coder for drag marker
                        GeoCoder.geocode({ location: $scope.marker.getPosition()})
                            .then(function (result) {
                                $scope.gpsForm.placeChanged(result[0]);
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
                            if ($scope.gpsForm.details.address_components.find(x => x.types[0] == "postal_code")) {
                                $scope.gpsForm.data.postCode = $scope.gpsForm.details.address_components
                                    .find(x => x.types[0] == "postal_code").long_name;
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

            if (type == "date") {
                if (!(value instanceof Date)) {
                    value = moment(value, 'DD/MM/YYYY').toDate();
                }
            }

            if (type == "time") {
                value = moment(value, 'h:mm a').toDate();
            }

            if (type == "select") {

            }

            $scope.gather.form = {
                id: "editField",
                title: "Edit " + label,
                fields: [
                    {
                        "name": fieldName,
                        "label": label + "...",
                        "value": value,
                        "jobID": jobID,
                        "type": type,
                        "options": options
                    }
                ],
                onSubmit: function () {
                    $scope.updateDetailField($scope.gather.form.fields[0].name, $scope.gather.form.fields[0].value, $scope.gather.form.fields[0].jobID);
                },
                submitValue: "Update Field"
            }
            $scope.gather.showForm();

        }

        $scope.updateDetailField = function (field, value, jobID) {

            var callData = {
                "jobID": jobID,
                "field": field,
                "value": value
            }

            uRunData.doAPI("Job/UpdateJobDetail", JSON.stringify(callData)).then(function (data) {

                if (data.response == "Success") {

                    var vmFields = field;
                    if (field == "BookDate") vmFields = "DeliveryDate";
                    if (field == "BookTime") vmFields = "ReadyTime";
                    if (field == "ToCompany") vmFields = "CompanyName";
                    if (field == "Qty") vmFields = "Items";
                    if (field == "ProofOfDeliveryMobile") vmFields = "Mobile";
                    if (field == "ProofOfDeliveryEmail") vmFields = "Email";

                    $scope.currentJob[vmFields] = value;

                } else {
                    alert(data.response);
                }

            });

        }

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
        }

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
// First published by Roger Sinnott in Sky & Telescope magazine in 1984 (“Virtues of the Haversine”)
//
function Haversine(lat1, lon1, lat2, lon2)
{
    var R = 6372.8; // Earth Radius in Kilometers

    var dLat = Deg2Rad(lat2-lat1);  
    var dLon = Deg2Rad(lon2-lon1);  

    var a = Math.sin(dLat/2) * Math.sin(dLat/2) + 
        Math.cos(Deg2Rad(lat1)) * Math.cos(Deg2Rad(lat2)) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);  
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
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
    for(var i = 0; i < locations.length; i++) 
    {
        // get the distance between user's location and this point
        //var dif = Haversine( locations[i][1], locations[i][2], latitude, longitude);
        var dif = Haversine( 
            parseFloat(locations[i][1].toString().substr(0,9)),
            parseFloat(locations[i][2].toString().substr(0,9)),
            parseFloat(latitude.toString().substr(0,9)),
            parseFloat(longitude.toString().substr(0,9))
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

