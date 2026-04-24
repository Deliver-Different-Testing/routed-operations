<div class="droppable-box" style="min-height:500px">

    <div class="table-b-headings builder">
        <table>
            <thead class="thead-dark no select">
            <tr>
                <th></th>
                <th ng-repeat="heading in boxes.runBuilder.headings" scope="col" ng-click="orderList(boxes.runBuilder.model,heading.name)">{{heading.label}} <i class="fa fa-caret-down" ng-show="sort[boxes.runBuilder.model] == heading.name"></i><i class="fa fa-caret-up" ng-show="sort.runBuilder == 'd-'+heading.name"></i></th>
            </tr>
            </thead>
        </table>

    </div>

    <div class="box-calculator">
                <div class="box-calculator-stat">
                    <div class="box-calculator-label">Total Mins</div>
                    <div class="box-calculator-value">{{calc.totalMins}}</div>
                </div><div class="box-calculator-stat">
                    <div class="box-calculator-label">Total KMs</div>
                    <div class="box-calculator-value">{{calc.totalKms}}</div>
                </div><div class="box-calculator-stat">
                    <div class="box-calculator-label">Total Drops</div>
                    <div class="box-calculator-value">{{calc.totalDrops}}</div>
                </div><div class="box-calculator-stat">
                    <div class="box-calculator-label">Hour %</div>
                    <div class="box-calculator-value">{{calc.timeAsHourPercent}}</div>
                </div><div class="box-calculator-stat">
                    <div class="box-calculator-label">Revenue</div>
                    <div class="box-calculator-value">{{calc.revenue | currency}}</div>
                </div><div class="box-calculator-stat">
                    <div class="box-calculator-label">Total Exp</div>
                    <div class="box-calculator-value">{{calc.petrolExpense | currency}}</div>
                </div><div class="box-calculator-stat">
                    <div class="box-calculator-label">Courier %</div>
                    <div class="box-calculator-value {{calc.courierPercentColour}}">{{calc.courierPercent}}</div>
                </div><div class="box-calculator-stat">
                    <div class="box-calculator-label">Hourly Rate</div>
                    <div class="box-calculator-value">$25.00</div>
                </div><div class="box-calculator-stat">
                    <div class="box-calculator-label">Total Payout</div>
                    <div class="box-calculator-value">{{calc.totalPayout | currency}}</div>
                </div>
    </div>


    <table class="table table-striped table-responsive table-rows builder" id="runBuilder" data-group="runBuilder">
        <tbody>
        <tr class="clickable-row draggable-row noselect" id="job-{{job.JobNumber}}" ng-class="{late: !job.toLat}" data-inbuilder="1" ng-repeat="job in runBuilder track by $index" context-menu="isVoidRunActive ? voidRunBuilderMenu : runBuilderMenu" data-jobid="{{job.BulkJobID}}" data-jobno="{{job.JobNo}}" data-index="{{$index}}" ng-mouseup="selectJob(job, true)">
            <td class="icons">
                <i class="fa fa-flag-checkered" ng-if="job.isEnd == 1"></i> 
			   <!--  {{$index + 1}} -->
			   {{job.BuilderIndex}}
                <i class="fa fa-play" ng-if="job.isStart == 1"></i>
				</td>
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
            <td class="selectjob" ng-click="selectForDispatch(job); $event.stopPropagation();" title="placeholder selector" style="display:none"></td>
            <td class="delete-row" ng-click="deleteFromRun(job,1); $event.stopPropagation();" title="placeholder selector" style="display:none"></td>
        </tr>
        <tr style="opacity:0">
            <td><div></div></td>
            <td><div></div></td>
            <td><div style="width:12px;"></div></td>
            <td><div></div></td>
          <!-- <td><div></div></td> -->
            <td><div></div></td>
            <td><div></div></td>
            <td><div></div></td>
            <td><div style="width:35px;"></div></td>
            <td><div style="width:30px;"></div></td>
            <td><div style="width:30px;"></div></td>
        </tr>
        </tbody>
    </table>




</div>

<div class="no-data" ng-if="runBuilder.length == 0">
    <div class="text">Please select a run with jobs or drop jobs here</div>
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
        $(this).find(".table-b-headings.builder").css({"top":newTop + 80});

        var newTop2 = $(this).scrollTop(); 
        $(this).find(".box-calculator").css({"top":newTop2});

    });

</script>