
    <div class="table-headings" ng-if="filtered.length > 0">
        <table>
            <thead class="thead-dark no select">
            <tr>
                <th ng-repeat="heading in boxes.jobsList.headings" scope="col" ng-click="orderList(boxes.jobsList.model,heading.name)">{{heading.label}} <i class="fa fa-caret-down" ng-show="sort[boxes.jobsList.model] == heading.name"></i><i class="fa fa-caret-up" ng-show="sort.jobList == 'd-'+heading.name"></i></th>
            </tr>
            </thead>
        </table>
    </div>

    <table class="table table-striped table-responsive table-rows" id="jobList" data-group="jobsGroup">
        <tbody>
        <tr class="clickable-row draggable-row noselect" ng-class="{late: !job.toLat}" ng-repeat="job in jobList | filter: box.searchBox | filter:{inBuilder: '!1', Void: '!1'} as filtered" context-menu="jobListMenu" data-jobid="{{job.BulkJobID}}" data-jobno="{{job.JobNo}}" data-index="{{$index}}" ng-mouseup="selectJob(job, true)">
            <td>{{job.ClientCode}}</td>
            <td>{{job.JobNumber}}</td>
            <td>{{job.DeliveryDate}}</td>
            <td>{{job.ReadyTime}}</td>
            <td>{{job.ToAddress}} <i ng-if="!job.toLat" class="fa fa-exclamation"></i></td>
            <td>{{job.ToSuburb}}</td>
           <!-- <td>{{job.RunMoreThan100}}</td> -->
            <td>{{job.ToPostCode}}</td>
            <td>{{job.CourierID}} </td>
            <td>{{getSpeedLabel(job.SpeedID)}} </td>
            <td class="selectjob" ng-click="addToRunBuilder(job); $event.stopPropagation();" title="placeholder selector" style="display:none"></td>
        </tr>
        <tr style="opacity:0">
            <td><div></div></td>
            <td><div></div></td>
            <td><div style="width:12px;"></div></td>
            <td><div></div></td>
            <td><div></div></td>
           <!-- <td><div></div></td> -->
            <td><div></div></td>
            <td><div></div></td>
            <td><div style="width:35px;"></div></td>
            <td><div style="width:30px;"></div></td>
        </tr>
        </tbody>
    </table>

<div class="no-data" ng-if="filtered < 1">
    <div class="text">Please select a group with jobs</div>
</div>


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