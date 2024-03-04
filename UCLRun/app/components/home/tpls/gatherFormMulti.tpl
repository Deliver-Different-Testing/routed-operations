
<div class="gatherForm gatherFormMulti" id="{{gather.form.id}}" ng-if="gather.form.tpl == 'multi'">

  <div class="gather-box">
    <div class="gather-title">{{gather.form.title}}</div>
    <div class="container-fluid">
      <div class="row">
        <div class="col-md-{{field.colSize}}" ng-repeat="field in gather.form.fields">
          <div class="form-group">
            <div ng-switch="field.type">
              <div ng-switch-default>
                <label for="jobNum">{{field.label}}:</label>
                <input type="text" placeholder="{{field.label}}" name="{{field.name}}" id="gather-{{field.name}}" ng-model="field.value" class="form-control focusMe" />
              </div>
              <div ng-switch-when="textarea">
                <label for="jobNum">{{field.label}}:</label>
                <textarea placeholder="{{field.label}}" name="{{field.name}}" id="gather-{{field.name}}" ng-model="field.value" class="form-control focusMe"></textarea>
              </div>
              <div ng-switch-when="time">
                <label for="jobNum">{{field.label}}:</label>
                 <input type="time" placeholder="{{field.label}}" name="{{field.name}}" id="gather-{{field.name}}" ng-model="field.value" class="form-control focusMe" />
              </div>
              <div ng-switch-when="date">
                <label for="jobNum">{{field.label}}:</label>
                 <input type="date" placeholder="{{field.label}}" name="{{field.name}}" id="gather-{{field.name}}" ng-model="field.value" class="form-control focusMe" />
              </div>
              <div ng-switch-when="select">

                 <select name="{{field.name}}" id="gather-{{field.name}}" ng-options="option as option.label for option in field.options track by option.id" ng-model="field.value" class="form-control focusMe">
                 </select>

              </div>
            </div>
          </div> 
        </div>
        <div class="col-md-12">

        <button class="btn btn-primary" ng-click="gather.submit()">{{gather.form.submitValue}}</button>
        <button class="btn btn-default" ng-click="gather.cancel()">Cancel</button>

        </div>
      </div>
    </div>
  </div>
</div>

send to live
send to test

click select on map

dispatching all?
