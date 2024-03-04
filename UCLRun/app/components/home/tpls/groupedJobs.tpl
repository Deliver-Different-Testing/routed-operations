

    <div class="table-headings">
        <table>
            <thead class="thead-dark no select">
            <tr>
                <th scope="col" ng-click="orderList('groupedJobs','name')">Group <i class="fa fa-caret-down" ng-show="sort.groupedJobs == 'name'"></i><i class="fa fa-caret-up" ng-show="sort.groupedJobs == 'd-name'"></i></th>
                <th scope="col" ng-click="orderList('groupedJobs','jobs')">Jobs <i class="fa fa-caret-down" ng-show="sort.groupedJobs == 'jobs'"></i><i class="fa fa-caret-up" ng-show="sort.groupedJobs == 'd-jobs'"></i></th>
            </tr>
            </thead>
        </table>

    </div>



    <table ng-if="sortingByTime" class="table table-striped table-responsive table-rows" id="jobsGroup" data-group="jobsGroup">
        <tbody>
        <tr class="clickable-row noselect" ng-dblclick="setTime()" data-isGroup="1" ng-repeat="grouped in groupedJobs" context-menu="groupedTimeMenu" data-index="{{$index}}" ng-mouseup="showJobs(grouped)" ng-if="(grouped.jobs | filter:{inBuilder:'!1'}).length != 0">
            <td>{{grouped.name}}</td>
            <td>{{(grouped.jobs | filter:{inBuilder:'!1'}).length}}</td>
            <td class="addTime" ng-click="addTime(grouped.name); $event.stopPropagation();" title="placeholder selector" style="display:none"></td>
        </tr>

		<!--  <tr class="clickable-row draggable-row noselect" data-isGroup="1" ng-repeat="grouped in groupedJobs" context-menu="groupedJobsMenu" data-index="{{$index}}" ng-mouseup="showJobs(grouped)" ng-if="(grouped.jobs | filter:{inBuilder:'!1'}).length != 0">
            <td>{{grouped.name}}</td>
            <td>{{(grouped.jobs | filter:{inBuilder:'!1'}).length}}</td>
            <td class="selectjob" ng-click="addGroupToRunBuilder(grouped.jobs); $event.stopPropagation();" title="placeholder selector" style="display:none"></td>
        </tr> -->

        <tr class="clickable-row draggable-row noselect empty" data-isGroup="1" ng-repeat="grouped in groupedJobs" data-index="{{$index}}" ng-mouseup="showJobs(grouped)" ng-if="(grouped.jobs | filter:{inBuilder:'!1'}).length == 0">
            <td>{{grouped.name}}</td>
            <td>{{(grouped.jobs | filter:{inBuilder:'!1'}).length}}</td>
            <td class="selectjob" ng-click="addGroupToRunBuilder(grouped.jobs); $event.stopPropagation();" title="placeholder selector" style="display:none"></td>
        </tr>

        <tr style="opacity:0">
            <td><div></div></td>
            <td><div></div></td>
        </tr>
        </tbody>
    </table>

    <table ng-if="!sortingByTime" class="table table-striped table-responsive table-rows" id="jobsGroup" data-group="jobsGroup">
        <tbody>
        <tr class="clickable-row draggable-row noselect" data-isGroup="1" ng-repeat="grouped in groupedJobs" context-menu="groupedJobsMenu" data-index="{{$index}}" ng-mouseup="showJobs(grouped)" ng-if="(grouped.jobs | filter:{inBuilder:'!1'}).length != 0">
            <td>{{grouped.name}}&nbsp&nbsp&nbsp&nbsp({{grouped.suburbNames}})</td>
            <td>{{(grouped.jobs | filter:{inBuilder:'!1'}).length}}</td>
            <td class="selectjob" ng-click="addGroupToRunBuilder(grouped.jobs); $event.stopPropagation();" title="placeholder selector" style="display:none"></td>
        </tr>

        <tr class="clickable-row draggable-row noselect empty" data-isGroup="1" ng-repeat="grouped in groupedJobs" data-index="{{$index}}" ng-mouseup="showJobs(grouped)" ng-if="(grouped.jobs | filter:{inBuilder:'!1'}).length == 0">
            <td>{{grouped.name}}</td>
            <td>{{(grouped.jobs | filter:{inBuilder:'!1'}).length}}</td>
            <td class="selectjob" ng-click="addGroupToRunBuilder(grouped.jobs); $event.stopPropagation();" title="placeholder selector" style="display:none"></td>
        </tr>

        <tr style="opacity:0">
            <td><div></div></td>
            <td><div></div></td>
        </tr>
        </tbody>
    </table>



<div class="loading" style="display:block">
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