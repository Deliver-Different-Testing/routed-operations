<div class="gatherForm" id="{{gather.form.id}}" ng-if="gather.form.tpl != 'multi'">
    <div class="gatherFields">
        <div class="gatherTitle">{{gather.form.title}}</div>
        <div ng-repeat="field in gather.form.fields" class="gatherField" style="display:inline-block; {{field.cssExtras}}">
          <div ng-switch="field.type">
            <div ng-switch-default>
              <input type="text" placeholder="{{field.label}}" name="{{field.name}}" id="gather-{{field.name}}" ng-model="field.value" class="form-control focusMe" />
            </div>
            <div ng-switch-when="textarea">
              <textarea placeholder="{{field.label}}" name="{{field.name}}" id="gather-{{field.name}}" ng-model="field.value" class="form-control focusMe"></textarea>
            </div>
            <div ng-switch-when="time">
               <input type="time" placeholder="{{field.label}}" name="{{field.name}}" id="gather-{{field.name}}" ng-model="field.value" class="form-control focusMe" />
            </div>
            <div ng-switch-when="date">
               <input type="date" placeholder="{{field.label}}" name="{{field.name}}" id="gather-{{field.name}}" ng-model="field.value" class="form-control focusMe" />
            </div>
            <div ng-switch-when="select">

               <!--<select name="{{field.name}}" id="gather-{{field.name}}" ng-options="option as option.label for option in field.options track by option.id" ng-model="field.value" class="form-control focusMe">
			   <option value="">-- please choose the run to transfer --</option>
			   </select> -->

			   <select name="{{field.name}}" id="gather-{{field.name}}" ng-model="field.value" class="form-control focusMe">
			   <option value="">-- please choose the run to transfer --</option>
			   <option ng-repeat="option in field.options track by option.id" value="{{option.id}}" ng-style="{'background': option.color}">{{option.label}}</option> 
			   </select>

            </div>
          </div>

        </div>
        <div class="gatherSubmit btn btn-primary" ng-click="gather.submit()">{{gather.form.submitValue}}</div>
        <button class="btn btn-default" ng-if="gather.form.fields[0].name == 'ToAddress'" ng-click="updateGPS('ToAddress')">Update GPS</button>
        <button class="btn btn-default" ng-click="gather.cancel()">Cancel</button>
    </div>

</div>