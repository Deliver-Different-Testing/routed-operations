

    <div class="table-headings">
        <table>
            <thead class="thead-dark no select">
            <tr>
                <th scope="col" ng-click="orderList('runList','name')">Run <i class="fa fa-caret-down" ng-show="sort.runList == 'name'"></i><i class="fa fa-caret-up" ng-show="sort.runList == 'd-name'"></i></th>
                <th scope="col" ng-click="orderList('runList','name')">Area <i class="fa fa-caret-down" ng-show="sort.runList == 'name'"></i><i class="fa fa-caret-up" ng-show="sort.runList == 'd-name'"></i></th>
                <th scope="col" ng-click="orderList('runList','jobs')">Jobs <i class="fa fa-caret-down" ng-show="sort.runList == 'jobs'"></i><i class="fa fa-caret-up" ng-show="sort.runList == 'd-jobs'"></i></th>
                <th scope="col" ng-click="orderList('runList','mins')">Mins <i class="fa fa-caret-down" ng-show="sort.runList == 'mins'"></i><i class="fa fa-caret-up" ng-show="sort.runList == 'd-mins'"></i></th>
                <th scope="col" ng-click="orderList('runList','kms')">KMs <i class="fa fa-caret-down" ng-show="sort.runList == 'kms'"></i><i class="fa fa-caret-up" ng-show="sort.runList == 'd-kms'"></i></th>
                <th scope="col" ng-click="orderList('runList','courierPercent')">% <i class="fa fa-caret-down" ng-show="sort.runList == 'courierPercent'"></i><i class="fa fa-caret-up" ng-show="sort.runList == 'd-courierPercent'"></i></th>
                <th scope="col" ng-click="orderList('runList','courier')">Courier <i class="fa fa-caret-down" ng-show="sort.runList == 'courier'"></i><i class="fa fa-caret-up" ng-show="sort.runList == 'd-courier'"></i></th>
            </tr>
            </thead>
        </table>

    </div>



    <table class="table table-striped table-responsive table-rows" id="runList" data-group="runList">
        <tbody>
        <tr class="clickable-row noselect droppable-item" ng-repeat="run in runList | filter:{ locked: '!1'}" context-menu="runListMenu" data-runid="{{run.ID}}" data-runname="{{run.name}}" data-jobno="{{job.JobNo}}" data-index="{{$index}}" ng-click="showRun(run)">
            <td style="width:20%">{{run.name}}</td>
            <td style="width:25%">{{runAreas(run)}}</td>
            <td style="width:10%">{{run.jobs.length}}</td>
            <td style="width:10%">{{run.mins}}</td>
            <td style="width:10%">{{run.kms}}</td>
            <td style="width:10%">{{run.courierPercent}}</td>
            <td ng-class="run.status == 18 ? 'preassigned': ''" style="width:15%">{{run.courier.courier}} <span ng-if="!run.courier.courier">Unassigned</span></td>
            <td class="selectjob" ng-click="selectGroupForDispatch(grouped); $event.stopPropagation();" title="placeholder selector" style="display:none"></td>
        </tr>

        <tr class="clickable-row noselect empty droppable-item" ng-repeat="run in runList | filter:{ locked: '1'}" ng-if="!run.isVoidRun" context-menu="runListMenu" data-runid="{{run.ID}}" data-runname="{{run.name}}" data-jobno="{{job.JobNo}}" data-index="{{$index}}" ng-style="run.runColor" ng-click="showRun(run)">
            <td style="width:20%">{{run.name}}</td>
            <td style="width:25%">{{runAreas(run)}}</td>
            <td style="width:10%">{{run.jobs.length}}</td>
            <td style="width:10%">{{run.mins}}</td>
            <td style="width:10%">{{run.kms}}</td>
            <td style="width:10%">{{run.courierPercent}}</td>
            <td ng-class="run.status == 18 ? 'preassigned': ''" style="width:15%">{{run.courier.courier}} <span ng-if="!run.courier.courier">Unassigned</span></td>
            <td class="selectjob" ng-click="selectGroupForDispatch(grouped); $event.stopPropagation();" title="placeholder selector" style="display:none"></td>
        </tr>

        <tr class="clickable-row noselect void-run" ng-repeat="run in runList" ng-if="run.isVoidRun" data-runid="{{run.ID}}" data-runname="{{run.name}}" data-index="{{$index}}" ng-click="showRun(run)">
            <td style="width:20%"><i class="fa fa-ban"></i> {{run.name}}</td>
            <td style="width:25%"></td>
            <td style="width:10%">{{run.jobs.length}}</td>
            <td style="width:10%"></td>
            <td style="width:10%"></td>
            <td style="width:10%"></td>
            <td style="width:15%"></td>
        </tr>


        <tr style="opacity:0">
            <td><div style="width:20%"></div></td>
            <td><div style="width:25%"></div></td>
            <td><div style="width:10%"></div></td>
            <td><div style="width:10%"></div></td>
            <td><div style="width:10%"></div></td>
            <td><div style="width:10%"></div></td>
            <td><div style="width:15%"></div></td>
        </tr>
        </tbody>
    </table>


<div class="loading">
    <div class="text">
        <i class="fas fa-spinner fa-spin fa-spin fa-3x fa-fw"></i>
        <span class="sr-only">Loading...</span>
    </div>
</div>

<script>

    $(".box-content").on("scroll", function() {
        var newTop = $(this).scrollTop();
        $(this).find(".table-headings").css({"top":newTop});
    });

</script>