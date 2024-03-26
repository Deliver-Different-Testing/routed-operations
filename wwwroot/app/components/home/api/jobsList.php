<? 


$params = json_decode(file_get_contents('php://input'),true);



$json = file_get_contents('jobsList.json'); 

$jobList = json_decode($json);
if ($params['status']) {
//echo ("reakz");


switch ($params['status']) {
    case "new":
        $jobList = array_filter($jobList, function($obj){
            if ($obj->Status == "D" || $obj->Status == "AC") {
                return true;
            } else {
                return false;
            }
        });
        break;
    case "dna":
        $jobList = array_filter($jobList, function($obj){
            if ($obj->Status == "P" || $obj->Status == "LD") {
                return true;
            } else {
                return false;
            }
        });
        break;
    case "active":
        $jobList = array_filter($jobList, function($obj){
            if ($obj->Status == "A" || $obj->Status == "AW") {
                return true;
            } else {
                return false;
            }
        });
        break;
    case "done":
        $jobList = array_filter($jobList, function($obj){
            if ($obj->Status == "C") {
                return true;
            } else {
                return false;
            }
        });
        break;
}

switch ($params['area']) {
    case "city":
        $jobList = array_filter($jobList, function($obj){
            if ($obj->ScreenFilter == "City") {
                return true;
            } else {
                return false;
            }
        });
        break;
    case "truck":
        $jobList = array_filter($jobList, function($obj){
            if ($obj->ScreenFilter == "Truck") {
                return true;
            } else {
                return false;
            }
        });
        break;
    case "main1":
        $jobList = array_filter($jobList, function($obj){
            if ($obj->ScreenFilter == "Main 1") {
                return true;
            } else {
                return false;
            }
        });
        break;
    case "main2":
        $jobList = array_filter($jobList, function($obj){
            if ($obj->ScreenFilter == "Main 2") {
                return true;
            } else {
                return false;
            }
        });
        break;
    case "central":
        $jobList = array_filter($jobList, function($obj){
            if ($obj->ScreenFilter == "Central") {
                return true;
            } else {
                return false;
            }
        });
        break;
    case "shore":
        $jobList = array_filter($jobList, function($obj){
            if ($obj->ScreenFilter == "Shore") {
                return true;
            } else {
                return false;
            }
        });
        break;
    case "west":
        $jobList = array_filter($jobList, function($obj){
            if ($obj->ScreenFilter == "West") {
                return true;
            } else {
                return false;
            }
        });
        break;
}


}




//print_r($new_array);

echo (json_encode(array_values($jobList)));

?>