all:
	gcc tiles.cpp -lsfml-graphics -lsfml-system -lsfml-window -lstdc++ -lm -g -o outtiles;
	./outtiles;
