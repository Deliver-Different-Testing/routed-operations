 <? 


$params = json_decode(file_get_contents('php://input'),true);



$json = file_get_contents('jobsRunList.json'); 

$jobList = json_decode($json);


//echo(count($jobList));
//print_r($jobList);

                    for($i=0; $i<count($jobList); $i++){

                        $name = $jobList[$i]->RunMoreThan100;
                        $new_array['MoreThan'][$name]['name'] = $name;
                        $new_array['MoreThan'][$name]['jobs'][] = $jobList[$i];

                    }

                    for($i=0; $i<count($jobList); $i++){

                        $name = $jobList[$i]->RunLessThan100;
                        $new_array['LessThan'][$name]['name'] = $name;
                        $new_array['LessThan'][$name]['jobs'][] = $jobList[$i];

                    }

//echo("sup");

//print_r($new_array);

echo (json_encode($new_array));

?>