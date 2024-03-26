<?

$params = json_decode(file_get_contents('php://input'),true);

$params['response'] = "Success";
$params['submitID'] = "123456";

print(json_encode($params));

?>